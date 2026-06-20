import type { Memory } from "../memory.js";

export interface ToolTradingContext {
  botId: string;
  tradingAccountId: string;
  actorType: "session" | "resident_agent" | "system";
  actorId: string | null;
  agentRunId: string | null;
  mandateId: string | null;
  capitalAllocationId: string | null;
}

export function resolveToolTradingContext(memory: Memory | null | undefined, sessionId?: string | null): ToolTradingContext {
  if (memory && sessionId) {
    const resident = memory.getResidentAgentBySessionId?.(sessionId);
    if (resident) {
      const run = memory.getActiveAgentRunBySessionId?.(sessionId);
      const assignment = memory.listAgentMandateAssignments?.(resident.id, { activeOnly: true })?.[0];
      return {
        botId: resident.botId,
        tradingAccountId: resident.tradingAccountId,
        actorType: "resident_agent",
        actorId: resident.id,
        agentRunId: run?.id ?? null,
        mandateId: run?.mandateIds?.[0] ?? assignment?.mandateId ?? null,
        capitalAllocationId: resident.capitalAllocationId ?? null,
      };
    }
  }

  if (memory && sessionId) {
    const binding = memory.getSessionBinding(sessionId);
    if (binding) {
      return {
        botId: binding.botId,
        tradingAccountId: binding.tradingAccountId,
        actorType: "session",
        actorId: sessionId,
        agentRunId: null,
        mandateId: null,
        capitalAllocationId: null,
      };
    }
  }

  const bot = memory?.getDefaultBot?.();
  if (memory && bot) {
    return {
      botId: bot.id,
      tradingAccountId: bot.tradingAccountId,
      actorType: sessionId ? "session" : "system",
      actorId: sessionId ?? null,
      agentRunId: null,
      mandateId: null,
      capitalAllocationId: null,
    };
  }

  return {
    botId: "default-bot",
    tradingAccountId: "default-trading-paper",
    actorType: sessionId ? "session" : "system",
    actorId: sessionId ?? null,
    agentRunId: null,
    mandateId: null,
    capitalAllocationId: null,
  };
}

export function checkBotFreeUsdt(
  memory: Memory | null | undefined,
  sessionId: string | null | undefined,
  requestedUsdt: number,
): string | null {
  if (!memory || !(requestedUsdt > 0)) return null;
  const ctx = resolveToolTradingContext(memory, sessionId);
  const alloc = memory.getBotAllocation?.(ctx.botId, ctx.tradingAccountId, "USDT");
  if (!alloc) return null;
  if (requestedUsdt > alloc.free) {
    return `Error: allocated_usdt ($${requestedUsdt}) exceeds active bot free USDT ($${alloc.free.toFixed(2)}).`;
  }
  return null;
}
