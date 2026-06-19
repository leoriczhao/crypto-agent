/**
 * IPC protocol between `crypto-daemon` (server) and `crypto-agent` CLI (client).
 * Line-delimited JSON over Unix domain socket.
 */

export const PROTOCOL_VERSION = 1;

// ─── Client → Server ───────────────────────────────────────────────────────

export type ClientMessage =
  | { type: "hello"; clientId: string; protocolVersion: number }
  | { type: "chat"; requestId: string; session: string; content: string }
  | { type: "slash"; requestId: string; command: string }
  | { type: "sessions" }
  | { type: "status" }
  | { type: "cancel"; requestId: string }
  | { type: "ping" };

// ─── Server → Client ───────────────────────────────────────────────────────

export type ServerMessage =
  | {
      type: "welcome";
      daemonPid: number;
      protocolVersion: number;
      mode: "PAPER" | "LIVE";
      exchange: string;
      bot: string;
      tradingAccount: string;
      soul: string;
      heartbeatInterval: number;
      fastPath: "running" | "idle" | "off";
    }
  | { type: "delta"; requestId: string; text: string } // cumulative text so far
  | { type: "tool_use"; requestId: string; name: string }
  | { type: "done"; requestId: string; final: string }
  | { type: "error"; requestId?: string; message: string }
  | { type: "slash_result"; requestId: string; text: string }
  | {
      type: "sessions_list";
      sessions: Array<{
        id: string;
        name: string;
        type: "user" | "system";
        messageCount: number;
        lastActiveAt: string;
      }>;
      activeId: string;
    }
  | {
      type: "status_snapshot";
      activeRules: number;
      openPositions: number;
      fastPath: "running" | "idle" | "off";
      snapshot: string;
    }
  | {
      type: "event";
      kind: "trade_entered" | "trade_exited" | "trade_rejected" | "heartbeat" | "review" | "feed_error" | "strategist_report";
      data: any;
      timestamp: number;
    }
  | { type: "pong" }
  | { type: "shutdown_notice"; reason: string };

/** Serialize a single message as a JSONL line (trailing \n included). */
export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg) + "\n";
}

/**
 * Parse a buffer of possibly-partial JSONL data and return complete messages.
 * Returns `{ messages, remaining }` where `remaining` is the incomplete tail.
 */
export function parseLines<T>(buffer: string): { messages: T[]; remaining: string } {
  const lines = buffer.split("\n");
  const remaining = lines.pop() ?? "";
  const messages: T[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as T);
    } catch {
      // malformed line; skip (should not happen in well-behaved peers)
    }
  }
  return { messages, remaining };
}
