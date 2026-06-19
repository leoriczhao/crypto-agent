import { useState, useCallback, useEffect, useRef } from "react";
import { IpcClient, type ChatHandle } from "../ipc/client.js";
import type { ServerMessage } from "../ipc/protocol.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export interface DaemonInfo {
  mode: "PAPER" | "LIVE";
  exchange: string;
  bot: string;
  tradingAccount: string;
  soul: string;
  daemonPid: number;
  heartbeatInterval: number;
  fastPath: "running" | "idle" | "off";
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (text: string) => void;
  connected: boolean;
  info: DaemonInfo | null;
  activeSession: string;
  cancel: () => void;
  shutdown: () => void;
}

/**
 * React hook that owns the IpcClient and exposes a chat-like state model.
 * Sessions and slash commands are all delegated to the daemon — this hook
 * never touches CryptoAgent directly.
 */
export function useChat(): UseChatReturn {
  const clientRef = useRef<IpcClient | null>(null);
  const activeChatRef = useRef<ChatHandle | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState<DaemonInfo | null>(null);
  const [activeSession, setActiveSession] = useState("user");

  const sysMsg = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: "system", content: text, timestamp: new Date() }]);
  }, []);

  useEffect(() => {
    const client = new IpcClient();
    clientRef.current = client;

    client.on("connected", (w: Extract<ServerMessage, { type: "welcome" }>) => {
      setConnected(true);
      setInfo({
        mode: w.mode,
        exchange: w.exchange,
        bot: w.bot,
        tradingAccount: w.tradingAccount,
        soul: w.soul,
        daemonPid: w.daemonPid,
        heartbeatInterval: w.heartbeatInterval,
        fastPath: w.fastPath,
      });
      sysMsg(`Connected to daemon (pid ${w.daemonPid})`);
    });

    client.on("disconnected", () => {
      setConnected(false);
      sysMsg("Disconnected from daemon — retrying...");
    });

    client.on("event", (ev: Extract<ServerMessage, { type: "event" }>) => {
      sysMsg(formatEvent(ev));
    });

    client.on("shutdown", (reason: string) => {
      sysMsg(`Daemon shutting down: ${reason}`);
    });

    client.on("server_error", (msg: string) => {
      sysMsg(`[server error] ${msg}`);
    });

    client.connect().catch((err) => {
      sysMsg(`Cannot connect to daemon: ${err.message ?? err}. Start it with \`npm run daemon\`.`);
    });

    return () => {
      client.close();
    };
  }, [sysMsg]);

  const handleSlash = useCallback(
    async (input: string): Promise<void> => {
      const client = clientRef.current;
      if (!client || !client.isConnected()) {
        sysMsg("Not connected to daemon.");
        return;
      }
      try {
        const text = await client.slash(input);
        sysMsg(text);

        // Keep activeSession in sync with daemon's response
        const parts = input.replace(/^\//, "").split(/\s+/);
        const cmd = parts[0]?.toLowerCase();
        const arg = parts.slice(1).join(" ").trim();
        if (cmd === "switch" && text.startsWith("✓ Switched")) {
          setActiveSession(arg);
        } else if (cmd === "new") {
          const match = text.match(/"([^"]+)"/);
          if (match) setActiveSession(match[1]);
        }
      } catch (err: any) {
        sysMsg(`[slash error] ${err.message ?? err}`);
      }
    },
    [sysMsg],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const client = clientRef.current;
      if (!client) return;
      if (isLoading) return;

      if (text.startsWith("/")) {
        handleSlash(text);
        return;
      }

      if (!client.isConnected()) {
        sysMsg("Not connected to daemon — cannot send message.");
        return;
      }

      setMessages((prev) => [...prev, { role: "user", content: text, timestamp: new Date() }]);
      setIsLoading(true);

      try {
        const handle = client.startChat(activeSession, text, {
          onDelta: (accumulated) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: accumulated }];
              }
              return [...prev, { role: "assistant", content: accumulated, timestamp: new Date() }];
            });
          },
          onToolUse: (toolName) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  { role: "system", content: `\u26a1 ${toolName}`, timestamp: new Date() },
                  last,
                ];
              }
              return [...prev, { role: "system", content: `\u26a1 ${toolName}`, timestamp: new Date() }];
            });
          },
        });
        activeChatRef.current = handle;
        await handle.promise;
      } catch (e: any) {
        const message = e.message ?? String(e);
        setMessages((prev) => [
          ...prev,
          { role: "system", content: message === "Cancelled" ? "Cancelled." : `Error: ${message}`, timestamp: new Date() },
        ]);
      } finally {
        activeChatRef.current = null;
        setIsLoading(false);
      }
    },
    [isLoading, handleSlash, activeSession, sysMsg],
  );

  const cancel = useCallback(() => {
    activeChatRef.current?.cancel();
  }, []);

  const shutdown = useCallback(() => {
    clientRef.current?.close();
  }, []);

  return { messages, isLoading, sendMessage, connected, info, activeSession, cancel, shutdown };
}

function formatEvent(ev: Extract<ServerMessage, { type: "event" }>): string {
  switch (ev.kind) {
    case "trade_entered": {
      const d = ev.data;
      return `[AUTO] Entered ${d.side} ${d.symbol} @ ${d.entryPrice} ($${d.sizeUsdt})`;
    }
    case "trade_exited": {
      const d = ev.data;
      const pnl = d.pnl ?? 0;
      const sign = pnl >= 0 ? "+" : "";
      return `[AUTO] Exited ${d.symbol} — PnL: ${sign}$${pnl.toFixed(2)}`;
    }
    case "trade_rejected":
      return `[RiskGate] Rejected ${ev.data.symbol} ${ev.data.action}: ${ev.data.reason}`;
    case "heartbeat":
      return `[Heartbeat] ${ev.data.response}`;
    case "review":
      return `[Review] ${ev.data.summary}…`;
    case "feed_error":
      return `[Feed] ${ev.data.key}: ${ev.data.error}`;
    case "strategist_report": {
      const task = ev.data.task ?? "";
      return `[STRATEGIST] ${task}\n${ev.data.report}`;
    }
  }
}
