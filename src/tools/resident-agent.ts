import { registerTool } from "./registry.js";
import { resolveToolTradingContext } from "./trading-context.js";
import { nextRunFromSchedule } from "../agents/runtime.js";
import type { ResidentAgentType } from "../memory.js";

function slugPart(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 40) || "agent";
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCapitalUsdt(value: unknown): number | null {
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function normalizeSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

function normalizeRiskPolicy(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

registerTool(
  "resident_agent",
  "Manage long-lived resident agents. Actions: spawn, status, pause, resume. Trader agents supervise strategy packages/deployments and require a capital allocation.",
  {
    type: "object",
    properties: {
      action: { type: "string", enum: ["spawn", "status", "pause", "resume"], default: "status" },
      agent_id: { type: "string", description: "Resident agent id for pause/resume" },
      type: { type: "string", enum: ["trader", "researcher", "risk_monitor", "strategist"], default: "trader" },
      name: { type: "string", description: "Resident agent name for spawn" },
      mandate_id: { type: "string", description: "Optional legacy strategy mandate id assigned to the agent" },
      interval_minutes: { type: "integer", default: 30 },
      capital_usdt: { type: "number", description: "USDT allocated to the resident trader's dedicated bot" },
      symbols: { type: "array", items: { type: "string" }, description: "Allowed market universe for the assignment" },
      risk_policy: { type: "object", description: "Runtime risk limits, e.g. max_leverage/max_total_notional_usdt" },
      instructions: { type: "string", description: "Long-term role instructions. Strategy logic belongs in strategy packages and deployments." },
    },
  },
  ["memory", "sessionId"],
  async ({
    memory,
    sessionId,
    action = "status",
    agent_id,
    type = "trader",
    name = "",
    mandate_id = "",
    interval_minutes = 30,
    capital_usdt,
    symbols,
    risk_policy,
    instructions = "",
  }) => {
    try {
      if (!memory) return "Error: memory is not initialized";

      if (action === "pause" || action === "resume") {
        if (!agent_id) return "Error: agent_id is required";
        const agent = memory.getResidentAgent(agent_id);
        if (!agent) return `Error: resident agent not found: ${agent_id}`;
        memory.setResidentAgentStatus(agent_id, action === "pause" ? "paused" : "active");
        return `Resident agent ${agent_id} ${action === "pause" ? "paused" : "resumed"}.`;
      }

      if (action === "spawn") {
        const agentType = String(type) as ResidentAgentType;
        const agentName = String(name).trim();
        if (!agentName) return "Error: name is required";
        const capital = parseCapitalUsdt(capital_usdt);
        if (agentType === "trader" && capital === null) return "Error: capital_usdt must be > 0 for trader agents";

        const mandateId = String(mandate_id || "").trim();
        const mandate = mandateId ? memory.getStrategyMandate(mandateId) : null;
        if (mandateId && (!mandate || mandate.status !== "active")) {
          return "Error: legacy mandate_id was provided but is not an active strategy mandate.";
        }

        const parentCtx = resolveToolTradingContext(memory, sessionId);
        const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const bot = memory.createTradingBot({
          id: `resident-${slugPart(agentName)}-${suffix}`,
          tradingAccountId: parentCtx.tradingAccountId,
          name: agentName,
        });
        const allocation = capital
          ? memory.ensureBotAllocation({
              botId: bot.id,
              tradingAccountId: parentCtx.tradingAccountId,
              asset: "USDT",
              amount: capital,
            })
          : null;
        const minutes = parsePositiveInteger(interval_minutes, 30);
        const scheduleExpr = `every_${minutes}m`;
        const policy = normalizeRiskPolicy(risk_policy);
        const allowedSymbols = normalizeSymbols(symbols);
        if (agentType === "trader" && allowedSymbols.length && !policy.allowed_symbols) {
          policy.allowed_symbols = allowedSymbols;
        }
        const agent = memory.createResidentAgent({
          type: agentType,
          name: agentName,
          botId: bot.id,
          tradingAccountId: parentCtx.tradingAccountId,
          capitalAllocationId: allocation?.id ?? null,
          scheduleExpr,
          nextRun: nextRunFromSchedule(scheduleExpr),
          mandate: String(instructions || "").trim() || "Supervise strategy package deployments. Hold or pause when the edge is unclear.",
          toolPolicy: `${agentType}.v2`,
          riskPolicy: policy,
        });

        if (mandate) {
          memory.assignMandateToAgent({
            agentId: agent.id,
            mandateId: mandate.id,
            universe: normalizeSymbols(symbols),
          });
        }

        return [
          `Resident agent created: ${agent.name} (${agent.id})`,
          `type=${agent.type}`,
          `bot=${agent.botId}`,
          `trading_account=${agent.tradingAccountId}`,
          `allocation=${agent.capitalAllocationId ?? "none"}`,
          `schedule=${agent.scheduleExpr}`,
          `next_run=${agent.nextRun ?? "none"}`,
          `packages=all_allowed`,
          `legacy_mandate=${mandate?.id ?? "none"}`,
        ].join("\n");
      }

      const agents = memory.listResidentAgents();
      if (!agents.length) return "No resident agents.";
      const lines = ["Resident Agents:", "ID | Status | Type | Bot | Schedule | Deployments | Legacy Mandates", "-".repeat(120)];
      for (const agent of agents) {
        const assignments = memory
          .listAgentMandateAssignments(agent.id, { activeOnly: true })
          .map((a: any) => a.mandateId)
          .join(", ") || "-";
        const deployments = memory
          .listStrategyDeployments()
          .filter((d: any) => d.residentTraderId === agent.id || d.botId === agent.botId)
          .map((d: any) => `${d.id}:${d.status}`)
          .join(", ") || "-";
        const runs = memory.listAgentRuns(agent.id, 1);
        const lastRun = runs[0] ? ` last_run=${runs[0].status}` : "";
        lines.push(`${agent.id} | ${agent.status} | ${agent.type} | ${agent.botId} | ${agent.scheduleExpr ?? "-"} | ${deployments} | ${assignments}${lastRun}`);
      }
      return lines.join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
