import { registerTool } from "./registry.js";
import { runSubAgent } from "../sub-agents.js";

registerTool(
  "delegate",
  "Delegate a task to a specialized sub-agent.\nRoles:\n- researcher: market analysis, news, on-chain data, technical indicators (read-only)\n- trader: executes trades, uses strategy and portfolio tools\n- risk_officer: evaluates portfolio risk, concentration, drawdowns (advisory)\n- strategist: hypothesize -> backtest -> create/validate strategy package OR log failure (autonomous research loop)\n\nThe sub-agent will run autonomously with its specialized tools and return a report.",
  {
    type: "object",
    properties: {
      role: { type: "string", enum: ["researcher", "trader", "risk_officer", "strategist"] },
      task: { type: "string", description: "Detailed description of what the sub-agent should do" },
    },
    required: ["role", "task"],
  },
  ["agent", "sessionId"],
  async ({ agent, sessionId, role, task }) => {
    try {
      const result = await runSubAgent(agent, sessionId, role, task);
      return `[${String(role).toUpperCase()}] ${result}`;
    } catch (e: any) {
      return `Delegation error: ${e.message ?? e}`;
    }
  },
);
