import { useState, useCallback, useEffect, useRef } from "react";
import { CryptoAgent } from "../agent.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export function useChat() {
  const agentRef = useRef<CryptoAgent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const agent = new CryptoAgent();
    agent.sessions.create("tui", "user");
    agentRef.current = agent;
    return () => {
      agentRef.current?.close();
    };
  }, []);

  const sysMsg = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: "system", content: text, timestamp: new Date() }]);
  }, []);

  const handleSlash = useCallback(
    (input: string): boolean => {
      const agent = agentRef.current;
      if (!agent) return false;

      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      const arg = parts.slice(1).join(" ").trim();
      const mgr = agent.sessions;

      switch (cmd) {
        case "new": {
          const name = arg || `session-${Date.now()}`;
          const s = mgr.create(name, "user");
          mgr.setActive(s.id);
          sysMsg(`✓ Created session "${name}" (${s.id.slice(0, 8)}…)`);
          return true;
        }
        case "sessions":
        case "list": {
          const sessions = mgr.list("user");
          if (!sessions.length) { sysMsg("No user sessions."); return true; }
          const lines = sessions.map((s) => {
            const active = s.id === mgr.activeId ? " ← active" : "";
            return `  ${s.name} [${s.id.slice(0, 8)}…] ${s.messages.length} msgs${active}`;
          });
          sysMsg("Sessions:\n" + lines.join("\n"));
          return true;
        }
        case "switch": {
          if (!arg) { sysMsg("Usage: /switch <name>"); return true; }
          const target = mgr.getByName(arg);
          if (!target || target.type !== "user") { sysMsg(`Session not found: "${arg}"`); return true; }
          mgr.setActive(target.id);
          sysMsg(`✓ Switched to "${target.name}" — ${target.messages.length} msgs`);
          return true;
        }
        case "current": {
          const s = mgr.active;
          sysMsg(`Session: ${s.name}\nID: ${s.id}\nMessages: ${s.messages.length}\nCreated: ${s.createdAt.toISOString()}`);
          return true;
        }
        case "help": {
          sysMsg(
            "Commands:\n" +
            "  /new [name]      Create new session\n" +
            "  /sessions        List sessions\n" +
            "  /switch <name>   Switch session\n" +
            "  /current         Session info\n" +
            "  /delete <name>   Delete session\n" +
            "  /help            This help",
          );
          return true;
        }
        case "delete": {
          if (!arg) { sysMsg("Usage: /delete <name>"); return true; }
          const dt = mgr.getByName(arg);
          if (!dt || dt.type !== "user") { sysMsg(`Session not found: "${arg}"`); return true; }
          if (dt.id === mgr.activeId) { sysMsg("Cannot delete active session."); return true; }
          mgr.delete(dt.id);
          sysMsg(`✓ Deleted "${dt.name}"`);
          return true;
        }
        default:
          sysMsg(`Unknown command: /${cmd}. Type /help`);
          return true;
      }
    },
    [sysMsg],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!agentRef.current || isLoading) return;

      if (text.startsWith("/")) {
        handleSlash(text);
        return;
      }

      setMessages((prev) => [...prev, { role: "user", content: text, timestamp: new Date() }]);
      setIsLoading(true);

      try {
        await agentRef.current.chatStream(text, {
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
      } catch (e: any) {
        setMessages((prev) => [
          ...prev,
          { role: "system", content: `Error: ${e.message ?? e}`, timestamp: new Date() },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, handleSlash],
  );

  return { messages, isLoading, sendMessage, agent: agentRef.current };
}
