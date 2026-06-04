import { registerTool } from "./registry.js";

registerTool(
  "plan_ladder_strategy",
  "Create a multi-level entry-ladder (DCA-style) strategy.\nUse when you want to scale INTO a position over a range of prices, not trigger on one signal.\n\nWorkflow:\n  - Price drops (long) or rises (short) → each level fires a market entry when its triggerPrice is hit.\n  - Combined position exits on a single weighted-average take-profit (and optional stop-loss).\n\n⚠️ allocated_usdt MUST be >= the sum of levels[].sizeUsdt. The TradeGuard enforces budget isolation: a ladder can't consume capital outside its allocation.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT" },
      side: { type: "string", enum: ["long", "short"] },
      levels: {
        type: "array",
        description: "Entry ladder. Long: triggerPrice descending (buy more as price drops). Short: ascending.",
        items: {
          type: "object",
          properties: {
            triggerPrice: { type: "number", description: "Market price at which this level fires" },
            sizeUsdt: { type: "number", description: "USDT notional added to the combined position at this level" },
          },
          required: ["triggerPrice", "sizeUsdt"],
        },
      },
      take_profit_pct: {
        type: "number",
        description: "Combined take-profit in percent from the weighted-average entry price across all filled levels.",
      },
      stop_loss_pct: {
        type: "number",
        description: "Optional combined stop-loss in percent from weighted-average entry. Omit to let the ladder ride.",
      },
      allocated_usdt: {
        type: "number",
        description: "Total budget for this ladder. MUST be >= sum(levels[].sizeUsdt). Typical: 1.2× the sum to leave headroom.",
      },
      enabled: { type: "boolean", default: true },
    },
    required: ["symbol", "side", "levels", "take_profit_pct", "allocated_usdt"],
  },
  ["strategy_store"],
  async ({
    strategy_store,
    symbol,
    side,
    levels,
    take_profit_pct,
    stop_loss_pct,
    allocated_usdt,
    enabled = true,
  }) => {
    try {
      if (!strategy_store) return "Error: strategy manager not initialized";
      if (!Array.isArray(levels) || levels.length < 2) {
        return "Error: levels must have at least 2 entries (otherwise use plan_strategy / signal kind)";
      }

      const totalSize = levels.reduce((a: number, l: any) => a + Number(l.sizeUsdt || 0), 0);
      if (allocated_usdt < totalSize) {
        return `Error: allocated_usdt ($${allocated_usdt}) must be >= sum(levels.sizeUsdt) = $${totalSize.toFixed(2)}.`;
      }

      // Sanity: for long, levels should be sorted descending; for short, ascending.
      // Don't reject — warn in the response if violated, since the LLM may have its reasons.
      const prices = levels.map((l: any) => Number(l.triggerPrice));
      const sortedDesc = [...prices].sort((a, b) => b - a);
      const sortedAsc = [...prices].sort((a, b) => a - b);
      const warnings: string[] = [];
      if (side === "long" && prices.join() !== sortedDesc.join()) {
        warnings.push("⚠  levels aren't sorted descending — long ladders usually go high→low");
      }
      if (side === "short" && prices.join() !== sortedAsc.join()) {
        warnings.push("⚠  levels aren't sorted ascending — short ladders usually go low→high");
      }

      const strat = strategy_store.addStrategy({
        kind: "ladder",
        symbol,
        params: {
          side,
          levels,
          takeProfitPct: take_profit_pct,
          stopLossPct: stop_loss_pct,
        },
        allocatedUsdt: allocated_usdt,
        enabled,
      });

      const lines = [
        `Ladder strategy created: ${strat.id.slice(0, 8)}… [kind=ladder]`,
        `  Symbol: ${symbol} | Side: ${side} | Levels: ${levels.length}`,
        `  Total sizing: $${totalSize.toFixed(2)} | Allocated: $${allocated_usdt}`,
        `  Combined TP: ${take_profit_pct}%${stop_loss_pct != null ? ` | SL: ${stop_loss_pct}%` : " | SL: none"}`,
        ...levels.map(
          (l: any, i: number) =>
            `    L${i}: trigger @${l.triggerPrice} size $${l.sizeUsdt}`,
        ),
        `  Enabled: ${enabled}`,
        "  The runtime will fire entries as prices hit each level.",
        ...warnings,
      ];
      return lines.join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
