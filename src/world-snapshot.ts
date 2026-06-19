import type { BaseExchange } from "./exchange/base.js";
import type { Broker } from "./broker/types.js";
import type { Memory } from "./memory.js";
import type { StrategyManager } from "./strategy/manager.js";
import { resolveToolTradingContext } from "./tools/trading-context.js";

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Build a concise world-state snapshot for the LLM system prompt.
 * This eliminates the need for the LLM to call get_portfolio/get_price
 * at the start of every conversation turn.
 * Target: ~200 tokens.
 */
export async function buildWorldSnapshot(
  opts: {
    paperTrading: boolean;
    strategyStore?: StrategyManager | null;
    memory?: Memory | null;
    broker?: Broker | null;
    exchange?: BaseExchange | null;
    sessionId?: string | null;
  },
): Promise<string> {
  const lines: string[] = [];

  try {
    const ctx = opts.memory ? resolveToolTradingContext(opts.memory, opts.sessionId) : null;
    const balance = opts.broker && ctx
      ? await opts.broker.fetchBalance(ctx.botId)
      : await opts.exchange?.fetchBalance() ?? {};
    const usdtFree = balance.USDT?.free ?? 0;
    const usdtTotal = balance.USDT?.total ?? usdtFree;
    lines.push(`Mode: ${opts.paperTrading ? "PAPER" : "LIVE"}`);
    lines.push(`USDT: $${usdtTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} (free: $${usdtFree.toLocaleString("en-US", { minimumFractionDigits: 2 })})`);

    if (ctx) {
      const allocation = opts.memory?.getBotAllocation?.(ctx.botId, ctx.tradingAccountId, "USDT");
      if (allocation) {
        lines.push(
          `Bot: ${ctx.botId} | allocation $${formatUsd(allocation.allocated)} | free $${formatUsd(allocation.free)} | used $${formatUsd(allocation.used)} | realized PnL $${formatUsd(allocation.realizedPnl)}`,
        );
      }
    }

    const positions = opts.broker && ctx
      ? await opts.broker.fetchPositions(ctx.botId)
      : await opts.exchange?.fetchPositions() ?? {};
    const posEntries = Object.entries(positions).filter(
      ([, pos]: [string, any]) => Math.abs(pos.amount ?? 0) > 0,
    );

    if (posEntries.length) {
      lines.push(`Positions (${posEntries.length}):`);
      for (const [key, pos] of posEntries as [string, any][]) {
        const amount = pos.amount ?? 0;
        const entry = pos.avg_entry_price ?? 0;
        const current = pos.current_price ?? entry;
        const pnl = entry > 0 ? ((current - entry) / entry * 100) : 0;
        const pnlStr = pnl >= 0 ? `+${pnl.toFixed(1)}%` : `${pnl.toFixed(1)}%`;
        const value = Math.abs(amount * current);
        lines.push(`  ${key}: ${amount > 0 ? "+" : ""}${amount} @ $${entry.toFixed(2)} → $${current.toFixed(2)} (${pnlStr}, $${value.toFixed(0)})`);
      }
    } else {
      lines.push("Positions: none");
    }

    const openOrders = opts.broker && ctx
      ? await opts.broker.fetchOpenOrders(null, ctx.botId)
      : typeof opts.exchange?.fetchOpenOrders === "function"
        ? await opts.exchange.fetchOpenOrders()
        : [];
    if (ctx || openOrders.length) lines.push(`Open orders: ${openOrders.length}`);
  } catch (err: any) {
    lines.push(`[Snapshot error: ${err.message ?? err}]`);
  }

  if (opts.strategyStore) {
    const active = opts.strategyStore.getActiveStrategies();
    if (active.length) {
      lines.push(`Active strategies: ${active.length} (${active.map(s => s.symbol).join(", ")})`);
    }
  }

  return lines.join("\n");
}
