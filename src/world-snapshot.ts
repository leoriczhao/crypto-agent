import type { BaseExchange } from "./exchange/base.js";
import type { StrategyManager } from "./strategy/manager.js";

/**
 * Build a concise world-state snapshot for the LLM system prompt.
 * This eliminates the need for the LLM to call get_portfolio/get_price
 * at the start of every conversation turn.
 * Target: ~200 tokens.
 */
export async function buildWorldSnapshot(
  exchange: BaseExchange,
  opts: {
    paperTrading: boolean;
    strategyStore?: StrategyManager | null;
  },
): Promise<string> {
  const lines: string[] = [];

  try {
    const balance = await exchange.fetchBalance();
    const usdtFree = balance.USDT?.free ?? 0;
    const usdtTotal = balance.USDT?.total ?? usdtFree;
    lines.push(`Mode: ${opts.paperTrading ? "PAPER" : "LIVE"}`);
    lines.push(`USDT: $${usdtTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} (free: $${usdtFree.toLocaleString("en-US", { minimumFractionDigits: 2 })})`);

    const positions = await exchange.fetchPositions();
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
