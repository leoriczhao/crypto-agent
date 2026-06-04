import { registerTool } from "./registry.js";

registerTool(
  "backtest",
  "Backtest a trading strategy on historical data.\nNamed strategies: sma_crossover, rsi_reversal, bollinger_bounce\nOr provide entry_conditions/exit_conditions arrays to test the same rules used by plan_strategy.\nReturns: total return, max drawdown, Sharpe ratio, win rate, trade count",
  {
    type: "object",
    properties: {
      strategy: { type: "string", enum: ["sma_crossover", "rsi_reversal", "bollinger_bounce"], description: "Named strategy (or omit if using conditions)" },
      symbol: { type: "string", default: "BTC/USDT" },
      timeframe: { type: "string", default: "1h" },
      limit: { type: "integer", description: "Number of historical candles (max 500)", default: 200 },
      params: { type: "object", description: 'Strategy parameters, e.g. {"short_period": 10, "long_period": 30}' },
      entry_conditions: {
        type: "array",
        description: "Entry conditions (same format as plan_strategy)",
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
      exit_conditions: {
        type: "array",
        description: "Exit conditions (same format as plan_strategy)",
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
      side: { type: "string", enum: ["long", "short"], default: "long" },
    },
    required: [],
  },
  ["exchange"],
  async ({ exchange, strategy, symbol = "BTC/USDT", timeframe = "1h", limit = 200, params, entry_conditions, exit_conditions, side = "long" }) => {
    const { BacktestEngine } = await import("../backtest.js");
    try {
      limit = Math.min(limit, 500);
      const ohlcv = await exchange.fetchOhlcv(symbol, timeframe, limit);
      if (ohlcv.length < 30) return `Insufficient data: got ${ohlcv.length} candles, need at least 30.`;

      const engine = new BacktestEngine(10000);
      const result = (entry_conditions && exit_conditions)
        ? engine.runConditionBased(ohlcv, entry_conditions, exit_conditions, side, symbol, timeframe)
        : engine.run(ohlcv, strategy ?? "sma_crossover", params, symbol, timeframe);

      const lines = [
        `Backtest Results: ${strategy} on ${symbol} (${timeframe})`,
        "=".repeat(50),
        `Period:          ${ohlcv.length} candles`,
        `Total Return:    ${result.totalReturn >= 0 ? "+" : ""}${result.totalReturn.toFixed(2)}%`,
        `Max Drawdown:    ${result.maxDrawdown.toFixed(2)}%`,
        `Sharpe Ratio:    ${result.sharpeRatio.toFixed(2)}`,
        `Win Rate:        ${result.winRate.toFixed(1)}%`,
        `Total Trades:    ${result.totalTrades}`,
      ];

      if (result.trades.length) {
        lines.push("", "Last 5 trades:");
        for (const t of result.trades.slice(-5)) {
          lines.push(`  ${t.side.toUpperCase().padEnd(4)}  @ ${t.price.toFixed(2)}`);
        }
      }

      if (result.equityCurve.length) {
        lines.push(
          "",
          "Starting Capital: $10,000.00",
          `Final Value:      $${result.equityCurve[result.equityCurve.length - 1].toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        );
      }

      return lines.join("\n");
    } catch (e: any) {
      return `Backtest error: ${e.message ?? e}`;
    }
  },
);
