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
  ["market_data"],
  async ({ market_data, symbol }) => {
    try {
      const data = await market_data.fetchTicker(symbol);
      return JSON.stringify(data, null, 2);
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
