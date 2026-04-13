import { registerTool } from "./registry.js";

registerTool(
  "backtest",
  "Backtest a trading strategy on historical data.\nStrategies: sma_crossover, rsi_reversal, bollinger_bounce\nReturns: total return, max drawdown, Sharpe ratio, win rate, trade count",
  {
    type: "object",
    properties: {
      strategy: { type: "string", enum: ["sma_crossover", "rsi_reversal", "bollinger_bounce"] },
      symbol: { type: "string", default: "BTC/USDT" },
      timeframe: { type: "string", default: "1h" },
      limit: { type: "integer", description: "Number of historical candles (max 500)", default: 200 },
      params: { type: "object", description: 'Strategy parameters, e.g. {"short_period": 10, "long_period": 30}' },
    },
    required: ["strategy"],
  },
  async ({ exchange, strategy, symbol = "BTC/USDT", timeframe = "1h", limit = 200, params }) => {
    const { BacktestEngine } = await import("../backtest.js");
    try {
      limit = Math.min(limit, 500);
      const ohlcv = await exchange.fetchOhlcv(symbol, timeframe, limit);
      if (ohlcv.length < 30) return `Insufficient data: got ${ohlcv.length} candles, need at least 30.`;

      const engine = new BacktestEngine(10000);
      const result = engine.run(ohlcv, strategy, params, symbol, timeframe);

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
