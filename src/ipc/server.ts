import { EventEmitter } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import { unlinkSync, existsSync, chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { encode, parseLines, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "./protocol.js";
import { socketPath } from "./paths.js";

export interface IpcServerHandlers {
  /**
   * Handle a chat request. The handler should call `onDelta`/`onToolUse` as the
   * LLM streams, and resolve with the final assistant text.
   */
  onChat(
    session: string,
    content: string,
    requestId: string,
    onDelta: (text: string) => void,
    onToolUse: (name: string) => void,
    signal: AbortSignal,
  ): Promise<string>;

  /**
   * Handle a slash command. Returns a formatted text result the CLI will render.
   * Return an object with `activeSessionChanged` to instruct the CLI to update
   * its local active-session pointer.
   */
  onSlash(command: string): Promise<{ text: string; activeSessionChanged?: string }>;

  /** Return a list of user-visible sessions and the currently active id. */
  onListSessions(): {
    sessions: Array<{ id: string; name: string; type: "user" | "system"; messageCount: number; lastActiveAt: string }>;
    activeId: string;
  };

  /** Return current runtime status for display. */
  onStatus(): Promise<{
    activeRules: number;
    openPositions: number;
    fastPath: "running" | "idle" | "off";
    snapshot: string;
  }>;

  /** Describe the daemon for the welcome message. */
  describe(): {
    mode: "PAPER" | "LIVE";
    exchange: string;
    soul: string;
    heartbeatInterval: number;
    fastPath: "running" | "idle" | "off";
  };
}

interface ClientSlot {
  id: string;
  socket: Socket;
  buffer: string;
  activeRequests: Map<string, ActiveRequest>;
}

interface ActiveRequest {
  controller: AbortController;
  cancelled: boolean;
}

/**
 * Unix-socket IPC server. Accepts multiple simultaneous clients, routes their
 * requests to the injected handlers, and broadcasts async events to all
 * connected clients.
 */
export class IpcServer extends EventEmitter {
  private server: Server | null = null;
  private clients = new Map<string, ClientSlot>();
  private handlers: IpcServerHandlers;
  private path: string;

  constructor(handlers: IpcServerHandlers) {
    super();
    this.handlers = handlers;
    this.path = socketPath();
  }

  async start(): Promise<void> {
    if (existsSync(this.path)) {
      try { unlinkSync(this.path); } catch {}
    }

    this.server = createServer((socket) => this.accept(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.path, () => {
        try { chmodSync(this.path, 0o600); } catch {}
        resolve();
      });
    });

    this.emit("listening", this.path);
  }

  get socketPath(): string {
    return this.path;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Broadcast an event message to every connected client. */
  broadcast(msg: ServerMessage): void {
    for (const slot of this.clients.values()) {
      this.send(slot, msg);
    }
  }

  async stop(reason = "Daemon shutting down"): Promise<void> {
    // Notify all clients
    this.broadcast({ type: "shutdown_notice", reason });

    // Close every client socket
    for (const slot of this.clients.values()) {
      this.abortAll(slot);
      try { slot.socket.end(); } catch {}
      try { slot.socket.destroy(); } catch {}
    }
    this.clients.clear();

    // Stop accepting
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    if (existsSync(this.path)) {
      try { unlinkSync(this.path); } catch {}
    }
  }

  private accept(socket: Socket): void {
    const slot: ClientSlot = {
      id: randomUUID(),
      socket,
      buffer: "",
      activeRequests: new Map(),
    };
    this.clients.set(slot.id, slot);

    socket.setEncoding("utf-8");
    socket.on("data", (chunk: string) => this.onData(slot, chunk));
    socket.on("close", () => {
      this.abortAll(slot);
      this.clients.delete(slot.id);
      this.emit("client_disconnect", slot.id);
    });
    socket.on("error", () => {
      // Let close handler clean up
    });

    this.emit("client_connect", slot.id);
  }

  private onData(slot: ClientSlot, chunk: string): void {
    slot.buffer += chunk;
    const { messages, remaining } = parseLines<ClientMessage>(slot.buffer);
    slot.buffer = remaining;
    for (const msg of messages) {
      this.route(slot, msg).catch((err) => {
        this.send(slot, { type: "error", message: `Handler error: ${err.message ?? err}` });
      });
    }
  }

  private async route(slot: ClientSlot, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello": {
        const d = this.handlers.describe();
        this.send(slot, {
          type: "welcome",
          daemonPid: process.pid,
          protocolVersion: PROTOCOL_VERSION,
          mode: d.mode,
          exchange: d.exchange,
          soul: d.soul,
          heartbeatInterval: d.heartbeatInterval,
          fastPath: d.fastPath,
        });
        return;
      }

      case "ping": {
        this.send(slot, { type: "pong" });
        return;
      }

      case "chat": {
        const active: ActiveRequest = { controller: new AbortController(), cancelled: false };
        slot.activeRequests.set(msg.requestId, active);
        const sendIfActive = (out: ServerMessage) => {
          if (slot.activeRequests.get(msg.requestId) !== active || active.cancelled) return;
          this.send(slot, out);
        };
        try {
          const final = await this.handlers.onChat(
            msg.session,
            msg.content,
            msg.requestId,
            (text) => sendIfActive({ type: "delta", requestId: msg.requestId, text }),
            (name) => sendIfActive({ type: "tool_use", requestId: msg.requestId, name }),
            active.controller.signal,
          );
          sendIfActive({ type: "done", requestId: msg.requestId, final });
        } catch (err: any) {
          if (!active.cancelled) {
            this.send(slot, {
              type: "error",
              requestId: msg.requestId,
              message: err.message ?? String(err),
            });
          }
        } finally {
          if (slot.activeRequests.get(msg.requestId) === active) {
            slot.activeRequests.delete(msg.requestId);
          }
        }
        return;
      }

      case "slash": {
        try {
          const result = await this.handlers.onSlash(msg.command);
          this.send(slot, { type: "slash_result", requestId: msg.requestId, text: result.text });
        } catch (err: any) {
          this.send(slot, {
            type: "error",
            requestId: msg.requestId,
            message: err.message ?? String(err),
          });
        }
        return;
      }

      case "sessions": {
        const list = this.handlers.onListSessions();
        this.send(slot, { type: "sessions_list", sessions: list.sessions, activeId: list.activeId });
        return;
      }

      case "status": {
        const s = await this.handlers.onStatus();
        this.send(slot, {
          type: "status_snapshot",
          activeRules: s.activeRules,
          openPositions: s.openPositions,
          fastPath: s.fastPath,
          snapshot: s.snapshot,
        });
        return;
      }

      case "cancel": {
        const active = slot.activeRequests.get(msg.requestId);
        if (!active) return;
        active.cancelled = true;
        active.controller.abort();
        slot.activeRequests.delete(msg.requestId);
        this.send(slot, { type: "error", requestId: msg.requestId, message: "Cancelled" });
        return;
      }
    }
  }

  private abortAll(slot: ClientSlot): void {
    for (const active of slot.activeRequests.values()) {
      active.cancelled = true;
      active.controller.abort();
    }
    slot.activeRequests.clear();
  }

  private send(slot: ClientSlot, msg: ServerMessage): void {
    if (slot.socket.destroyed) return;
    try {
      slot.socket.write(encode(msg));
    } catch {
      // Socket may have closed between write checks — drop silently
    }
  }
}
