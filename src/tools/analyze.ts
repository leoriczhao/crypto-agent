import { registerTool } from "./registry.js";
import { computeSma, computeRsi, computeBollinger, generateSignals } from "../indicators.js";

registerTool(
  "analyze",
  "Technical analysis for a symbol: SMA, RSI, Bollinger Bands, and buy/sell signals.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT", default: "BTC/USDT" },
      timeframe: { type: "string", description: "Candle interval", default: "1h" },
    },
    required: [],
  },
  async ({ exchange, symbol = "BTC/USDT", timeframe = "1h" }) => {
    try {
      const klines = await exchange.fetchOhlcv(symbol, timeframe, 100);
      const closes: number[] = klines.map((k: any) => (typeof k === "object" ? k.close : k[4]));

      if (closes.length < 2) return `Insufficient data for ${symbol} (${closes.length} candles).`;

      const lastPrice = closes[closes.length - 1];
      const sma20 = computeSma(closes, 20);
      const sma50 = computeSma(closes, 50);
      const rsi = computeRsi(closes);
      const [bbLower, bbMid, bbUpper] = computeBollinger(closes);

      const lines = [
        `Technical Analysis: ${symbol} (${timeframe})`,
        "=".repeat(45),
        `Last Price: ${lastPrice.toFixed(2)}`,
        "",
        "Moving Averages:",
        `  SMA(20):  ${sma20.toFixed(2)}${sma20 === 0 ? " ⚠️ insufficient data" : ""}`,
        `  SMA(50):  ${sma50.toFixed(2)}${sma50 === 0 ? " ⚠️ insufficient data" : ""}`,
        "",
        `RSI(14):    ${rsi.toFixed(1)}${rsi < 30 ? " [Oversold]" : rsi > 70 ? " [Overbought]" : " [Neutral]"}`,
        "",
        "Bollinger Bands(20, 2):",
        `  Upper:  ${bbUpper.toFixed(2)}`,
        `  Middle: ${bbMid.toFixed(2)}`,
        `  Lower:  ${bbLower.toFixed(2)}`,
      ];

      if (sma20 && sma50) {
        const trend = sma20 > sma50 ? "BULLISH" : "BEARISH";
        lines.push("", `Trend: ${trend} (SMA20 ${sma20 > sma50 ? ">" : "<"} SMA50)`);
      }

      const signals = generateSignals(closes, lastPrice);
      lines.push("", "Trading Signals:", "=".repeat(45));
      for (const sig of signals) lines.push(`  \u2022 ${sig}`);

      const buyCount = signals.filter((s) => s.includes("BUY") || s.includes("BULLISH")).length;
      const sellCount = signals.filter((s) => s.includes("SELL") || s.includes("BEARISH")).length;
      if (buyCount > sellCount) lines.push(`\nOverall: BULLISH (${buyCount} buy vs ${sellCount} sell)`);
      else if (sellCount > buyCount) lines.push(`\nOverall: BEARISH (${sellCount} sell vs ${buyCount} buy)`);
      else lines.push("\nOverall: NEUTRAL");

      return lines.join("\n");
    } catch (e: any) {
      return `Error in analyze: ${e.message ?? e}`;
    }
  },
);
