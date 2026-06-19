import { registerTool } from "./registry.js";
import { checkBotFreeUsdt } from "./trading-context.js";

registerTool(
  "plan_strategy",
  "Create a trading strategy rule for the automated execution engine.\nThe rule will be evaluated on every market tick — NO LLM involvement in execution.\n⚠️ timeframe MUST match the timeframe used to backtest this hypothesis. If you backtested on 4h candles, the rule must run on 4h candles — otherwise indicators computed at execution time are meaningless.\nSpecify entry/exit conditions using indicators (rsi, sma_cross, bollinger, price_level, volume).\nOperators: gt, lt, gte, lte, cross_above, cross_below.\nThe rule is persisted and starts executing immediately if enabled.",
  {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["signal"],
        description: "Strategy type. Only 'signal' (indicator-triggered) is implemented in B1; future kinds (grid, dca, market_making) will extend this.",
      },
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT" },
      timeframe: {
        type: "string",
        enum: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"],
        description: "Candle timeframe for live evaluation — MUST equal the timeframe of the backtest you just validated.",
      },
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
      position_size_usdt: { type: "number", description: "Position size per entry in USDT" },
      allocated_usdt: {
        type: "number",
        description: "Total USDT budget dedicated to this strategy. Must be >= position_size_usdt × N where N is the max concurrent positions you'd allow. Typical default: position_size × 5. TradeGuard enforces: strategy's live usage + new entry cannot exceed this.",
      },
      stop_loss_pct: { type: "number", description: "Stop-loss percentage (e.g. 2 for 2%)" },
      take_profit_pct: { type: "number", description: "Take-profit percentage (e.g. 4 for 4%)" },
      enabled: { type: "boolean", default: true },
    },
    required: ["symbol", "timeframe", "side", "entry", "exit", "position_size_usdt", "allocated_usdt", "stop_loss_pct", "take_profit_pct"],
  },
  ["strategy_store", "memory", "sessionId"],
  async ({
    strategy_store,
    memory,
    sessionId,
    kind = "signal",
    symbol,
    timeframe,
    side,
    entry,
    exit,
    position_size_usdt,
    allocated_usdt,
    stop_loss_pct,
    take_profit_pct,
    enabled = true,
  }) => {
    try {
      if (!strategy_store) return "Error: strategy manager not initialized";
      if (kind !== "signal") {
        return `Error: kind='${kind}' not implemented yet. Only 'signal' is supported in this iteration.`;
      }
      if (allocated_usdt == null || allocated_usdt < position_size_usdt) {
        return `Error: allocated_usdt ($${allocated_usdt}) must be >= position_size_usdt ($${position_size_usdt}). Typical default: position_size_usdt × 5.`;
      }
      const botAllocationError = checkBotFreeUsdt(memory, sessionId, allocated_usdt);
      if (botAllocationError) return botAllocationError;
      const strat = strategy_store.addStrategy({
        kind: "signal",
        symbol,
        params: {
          timeframe,
          side,
          entry,
          exit,
          positionSizeUsdt: position_size_usdt,
          stopLossPct: stop_loss_pct,
          takeProfitPct: take_profit_pct,
        },
        allocatedUsdt: allocated_usdt,
        enabled,
      });
      return [
        `Strategy created: ${strat.id.slice(0, 8)}… [kind=signal]`,
        `  Symbol: ${symbol} | Timeframe: ${timeframe} | Side: ${side}`,
        `  Entry conditions: ${entry.length} | Exit conditions: ${exit.length}`,
        `  Size: $${position_size_usdt} per entry | Allocated: $${allocated_usdt}`,
        `  SL: ${stop_loss_pct}% | TP: ${take_profit_pct}%`,
        `  Enabled: ${enabled}`,
        `  The runtime will evaluate this strategy on every ${timeframe} candle + tick.`,
      ].join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
