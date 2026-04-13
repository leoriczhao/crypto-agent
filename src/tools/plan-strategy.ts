import { registerTool } from "./registry.js";

registerTool(
  "plan_strategy",
  "Create a trading strategy rule for the automated execution engine.\nThe rule will be evaluated on every market tick — NO LLM involvement in execution.\nSpecify entry/exit conditions using indicators (rsi, sma_cross, bollinger, price_level, volume).\nOperators: gt, lt, gte, lte, cross_above, cross_below.\nThe rule is persisted and starts executing immediately if enabled.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT" },
      side: { type: "string", enum: ["long", "short"] },
      entry: {
        type: "array",
        description: "AND conditions for entry. Each: { indicator, operator, value, params? }",
        items: {
          type: "object",
          properties: {
            indicator: { type: "string", enum: ["rsi", "sma_cross", "bollinger", "price_level", "volume"] },
            operator: { type: "string", enum: ["gt", "lt", "gte", "lte", "cross_above", "cross_below"] },
            value: { type: "number" },
            params: { type: "object", description: "e.g. { period: 14 } for RSI, { short: 10, long: 30 } for SMA" },
          },
          required: ["indicator", "operator", "value"],
        },
      },
      exit: {
        type: "array",
        description: "AND conditions for exit (same format as entry)",
        items: {
          type: "object",
          properties: {
            indicator: { type: "string", enum: ["rsi", "sma_cross", "bollinger", "price_level", "volume"] },
            operator: { type: "string", enum: ["gt", "lt", "gte", "lte", "cross_above", "cross_below"] },
            value: { type: "number" },
            params: { type: "object" },
          },
          required: ["indicator", "operator", "value"],
        },
      },
      position_size_usdt: { type: "number", description: "Position size in USDT" },
      stop_loss_pct: { type: "number", description: "Stop-loss percentage (e.g. 2 for 2%)" },
      take_profit_pct: { type: "number", description: "Take-profit percentage (e.g. 4 for 4%)" },
      enabled: { type: "boolean", default: true },
    },
    required: ["symbol", "side", "entry", "exit", "position_size_usdt", "stop_loss_pct", "take_profit_pct"],
  },
  async ({ strategy_store, symbol, side, entry, exit, position_size_usdt, stop_loss_pct, take_profit_pct, enabled = true }) => {
    try {
      if (!strategy_store) return "Error: strategy engine not initialized";
      const rule = strategy_store.addRule({
        symbol,
        side,
        entry,
        exit,
        positionSizeUsdt: position_size_usdt,
        stopLossPct: stop_loss_pct,
        takeProfitPct: take_profit_pct,
        enabled,
      });
      return [
        `Strategy rule created: ${rule.id.slice(0, 8)}…`,
        `  Symbol: ${symbol} | Side: ${side}`,
        `  Entry conditions: ${entry.length} | Exit conditions: ${exit.length}`,
        `  Size: $${position_size_usdt} | SL: ${stop_loss_pct}% | TP: ${take_profit_pct}%`,
        `  Enabled: ${enabled}`,
        `  The execution engine will evaluate this rule on every tick.`,
      ].join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
