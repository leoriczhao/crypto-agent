import { registerTool } from "./registry.js";

registerTool(
  "buy",
  "Buy cryptocurrency. Places a market or limit buy order. Checks against max order size.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT" },
      amount: { type: "number", description: "Quantity of base currency to buy" },
      order_type: { type: "string", enum: ["market", "limit"], default: "market" },
      price: { type: "number", description: "Limit price (required for limit orders)" },
    },
    required: ["symbol", "amount"],
  },
  async ({ exchange, config, memory, sessionId, symbol, amount, order_type = "market", price }) => {
    try {
      if (amount <= 0) return "Error: amount must be > 0";
      const ticker = await exchange.fetchTicker(symbol);
      const cost = ticker.last * amount;
      if (cost > config.maxOrderSizeUsdt) {
        return `Error: Order size $${cost.toFixed(2)} exceeds max $${config.maxOrderSizeUsdt.toFixed(2)}. Reduce amount or adjust config.`;
      }
      const mode = config.paperTrading ? "PAPER" : "LIVE";
      const result = await exchange.createOrder(symbol, "buy", order_type, amount, price);
      if (result.error) return `[${mode}] Buy failed: ${result.error}`;

      if (memory && sessionId) {
        memory.logTrade(sessionId, {
          symbol,
          side: "buy",
          amount,
          price: result.price ?? ticker.last,
          order_type,
          mode,
        });
      }

      return `[${mode}] Buy order filled:\n${JSON.stringify(result, null, 2)}`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
