import { registerTool } from "./registry.js";

registerTool(
  "session",
  "Manage conversation sessions.\n- list: show all user sessions\n- create: start a new named session and switch to it\n- switch: switch to an existing session by ID\n- current: show current session info",
  {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "create", "switch", "current"],
        description: "Action to perform",
      },
      name: { type: "string", description: "Name for the new session (used with 'create')" },
      session_id: { type: "string", description: "Session ID to switch to (used with 'switch')" },
    },
    required: ["action"],
  },
  async ({ agent, action, name, session_id }) => {
    try {
      const mgr = agent.sessions;

      if (action === "current") {
        const s = mgr.active;
        return `Current session: "${s.name}" (${s.id.slice(0, 8)}…)\nType: ${s.type}\nMessages: ${s.messages.length}\nCreated: ${s.createdAt.toISOString()}\nLast active: ${s.lastActiveAt.toISOString()}`;
      }

      if (action === "list") {
        const sessions: Array<{ id: string; name: string; messages: unknown[] }> = mgr.list("user");
        if (!sessions.length) return "No user sessions.";
        const lines = sessions.map((s) => {
          const active = s.id === mgr.activeId ? " (active)" : "";
          return `• "${s.name}" [${s.id.slice(0, 8)}…] — ${s.messages.length} msgs${active}`;
        });
        return lines.join("\n");
      }

      if (action === "create") {
        if (!name) return "Error: provide a name for the new session.";
        const session = mgr.create(name, "user");
        if (agent.memory) {
          agent.memory.createSession(session.id, name, "user");
        }
        mgr.setActive(session.id);
        return `Created and switched to session "${name}" (${session.id.slice(0, 8)}…)`;
      }

      if (action === "switch") {
        if (!session_id) return "Error: provide session_id to switch to.";
        const s = mgr.get(session_id);
        if (s.type !== "user") return "Error: cannot switch to a system session.";
        mgr.setActive(session_id);
        return `Switched to session "${s.name}" (${s.id.slice(0, 8)}…) — ${s.messages.length} messages`;
      }

      return `Unknown action: ${action}`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
