import type { Memory } from "../memory.js";

export interface ToolTradingContext {
  botId: string;
  tradingAccountId: string;
  actorType: "session" | "llm_trader" | "system";
  actorId: string | null;
}

export function resolveToolTradingContext(memory: Memory | null | undefined, sessionId?: string | null): ToolTradingContext {
  if (memory && sessionId) {
    const traderJob = memory.getLlmTraderJobBySessionId?.(sessionId);
    if (traderJob) {
      return {
        botId: traderJob.botId,
        tradingAccountId: traderJob.tradingAccountId,
        actorType: "llm_trader",
        actorId: String(traderJob.id),
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
    };
  }

  return {
    botId: "default-bot",
    tradingAccountId: "default-trading-paper",
    actorType: sessionId ? "session" : "system",
    actorId: sessionId ?? null,
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
