import { registerTool } from "./registry.js";

registerTool(
  "get_klines",
  "Get OHLCV candlestick data for technical analysis or backtesting.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT" },
      timeframe: { type: "string", description: "Candle interval: 1m,5m,15m,1h,4h,1d", default: "1h" },
      limit: { type: "integer", description: "Number of candles", default: 24 },
    },
    required: ["symbol"],
  },
  async ({ exchange, symbol, timeframe = "1h", limit = 24 }) => {
    try {
      const data = await exchange.fetchOhlcv(symbol, timeframe, limit);
      return JSON.stringify(data.slice(-limit), null, 2);
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
