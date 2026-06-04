import { EventEmitter } from "node:events";
import { Socket, connect as netConnect } from "node:net";
import { randomUUID } from "node:crypto";
import { encode, parseLines, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "./protocol.js";
import { socketPath } from "./paths.js";

export interface ChatCallbacks {
  onDelta?: (text: string) => void;
  onToolUse?: (name: string) => void;
}

export interface IpcClientOptions {
  /** Reconnect delay in ms between attempts. Default 2000. */
  reconnectDelayMs?: number;
  /** Socket path override (otherwise resolved from env / default). */
  path?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  kind: "chat" | "slash" | "sessions" | "status";
  onDelta?: (text: string) => void;
  onToolUse?: (name: string) => void;
}

export interface ChatHandle {
  requestId: string;
  promise: Promise<string>;
  cancel: () => void;
}

/**
 * Thin IPC client. Maintains a connection to the daemon, auto-reconnects if
 * the connection drops, and correlates requests/responses by requestId.
 *
 * Events:
 *   - "connected"    → welcome payload
 *   - "disconnected" → reason
 *   - "event"        → server_event (auto-trades, heartbeat, etc.)
 *   - "shutdown"     → server is going away
 */
export class IpcClient extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = "";
  private pending = new Map<string, PendingRequest>();
  private path: string;
  private reconnectDelayMs: number;
  private clientId: string;
  private connected = false;
  private intentionallyClosed = false;

  constructor(opts: IpcClientOptions = {}) {
    super();
    this.path = opts.path ?? socketPath();
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 2000;
    this.clientId = `cli-${process.pid}-${randomUUID().slice(0, 6)}`;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.intentionallyClosed = false;
    await this.connectOnce();
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.socket) {
      try { this.socket.end(); } catch {}
      try { this.socket.destroy(); } catch {}
      this.socket = null;
    }
    this.rejectAllPending(new Error("Client closed"));
  }

  /**
   * Send a chat request and await the full assistant response.
   * Streaming deltas are delivered via callbacks.
   */
  async chat(session: string, content: string, cbs: ChatCallbacks = {}): Promise<string> {
    return this.startChat(session, content, cbs).promise;
  }

  /**
   * Start a chat request and return its requestId plus a cancellation hook.
   * Existing callers can keep using chat(); UI callers use this to stop an
   * in-flight model stream without closing the daemon connection.
   */
  startChat(session: string, content: string, cbs: ChatCallbacks = {}): ChatHandle {
    const requestId = randomUUID();
    const promise = new Promise<string>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        kind: "chat",
        onDelta: cbs.onDelta,
        onToolUse: cbs.onToolUse,
      });
      this.write({ type: "chat", requestId, session, content });
    });
    return {
      requestId,
      promise,
      cancel: () => this.cancel(requestId),
    };
  }

  cancel(requestId: string): void {
    if (!this.pending.has(requestId)) return;
    this.write({ type: "cancel", requestId });
  }

  async slash(command: string): Promise<string> {
    const requestId = randomUUID();
    return new Promise<string>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, kind: "slash" });
      this.write({ type: "slash", requestId, command });
    });
  }

  async listSessions(): Promise<Extract<ServerMessage, { type: "sessions_list" }>> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      this.pending.set(requestId, { resolve, reject, kind: "sessions" });
      this.write({ type: "sessions" });
    });
  }

  async status(): Promise<Extract<ServerMessage, { type: "status_snapshot" }>> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      this.pending.set(requestId, { resolve, reject, kind: "status" });
      this.write({ type: "status" });
    });
  }

  private async connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = netConnect(this.path);
      socket.setEncoding("utf-8");

      const onError = (err: Error) => {
        socket.removeAllListeners();
        reject(err);
      };

      socket.once("error", onError);
      socket.once("connect", () => {
        socket.removeListener("error", onError);
        this.socket = socket;
        this.connected = true;
        this.buffer = "";
        this.wireSocket(socket);
        // Send hello and wait for welcome
        this.write({ type: "hello", clientId: this.clientId, protocolVersion: PROTOCOL_VERSION });
        resolve();
      });
    });
  }

  private wireSocket(socket: Socket): void {
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("close", () => this.onClose());
    socket.on("error", () => {
      // close handler will fire
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const { messages, remaining } = parseLines<ServerMessage>(this.buffer);
    this.buffer = remaining;
    for (const msg of messages) this.dispatch(msg);
  }

  private dispatch(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome":
        this.emit("connected", msg);
        return;

      case "delta": {
        const p = this.pending.get(msg.requestId);
        if (p?.kind === "chat") p.onDelta?.(msg.text);
        return;
      }

      case "tool_use": {
        const p = this.pending.get(msg.requestId);
        if (p?.kind === "chat") p.onToolUse?.(msg.name);
        return;
      }

      case "done": {
        const p = this.pending.get(msg.requestId);
        if (p?.kind === "chat") {
          this.pending.delete(msg.requestId);
          p.resolve(msg.final);
        }
        return;
      }

      case "slash_result": {
        const p = this.pending.get(msg.requestId);
        if (p?.kind === "slash") {
          this.pending.delete(msg.requestId);
          p.resolve(msg.text);
        }
        return;
      }

      case "sessions_list": {
        const p = this.firstPendingOfKind("sessions");
        if (p) {
          this.pending.delete(p.id);
          p.req.resolve(msg);
        }
        return;
      }

      case "status_snapshot": {
        const p = this.firstPendingOfKind("status");
        if (p) {
          this.pending.delete(p.id);
          p.req.resolve(msg);
        }
        return;
      }

      case "error": {
        if (msg.requestId) {
          const p = this.pending.get(msg.requestId);
          if (p) {
            this.pending.delete(msg.requestId);
            p.reject(new Error(msg.message));
          }
          return;
        }
        this.emit("server_error", msg.message);
        return;
      }

      case "event":
        this.emit("event", msg);
        return;

      case "shutdown_notice":
        this.emit("shutdown", msg.reason);
        return;

      case "pong":
        return;
    }
  }

  private firstPendingOfKind(kind: "sessions" | "status") {
    for (const [id, req] of this.pending.entries()) {
      if (req.kind === kind) return { id, req };
    }
    return null;
  }

  private onClose(): void {
    this.connected = false;
    this.socket = null;
    this.rejectAllPending(new Error("Connection lost"));
    this.emit("disconnected");

    if (!this.intentionallyClosed) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    setTimeout(async () => {
      if (this.intentionallyClosed) return;
      try {
        await this.connectOnce();
      } catch {
        this.scheduleReconnect();
      }
    }, this.reconnectDelayMs);
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private write(msg: ClientMessage): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Not connected to daemon");
    }
    this.socket.write(encode(msg));
  }
}
