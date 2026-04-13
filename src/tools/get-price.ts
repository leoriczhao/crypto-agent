import { registerTool } from "./registry.js";

registerTool(
  "get_price",
  "Get current price, 24h change, and volume for a cryptocurrency.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT" },
    },
    required: ["symbol"],
  },
  async ({ exchange, symbol }) => {
    try {
      const data = await exchange.fetchTicker(symbol);
      return JSON.stringify(data, null, 2);
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
