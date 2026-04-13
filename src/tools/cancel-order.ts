import { registerTool } from "./registry.js";

registerTool(
  "cancel_order",
  "Cancel an open order by ID.",
  {
    type: "object",
    properties: {
      order_id: { type: "string", description: "Order ID to cancel" },
      symbol: { type: "string", description: "Trading pair the order belongs to" },
    },
    required: ["order_id", "symbol"],
  },
  async ({ exchange, order_id, symbol }) => {
    try {
      const result = await exchange.cancelOrder(order_id, symbol);
      return JSON.stringify(result, null, 2);
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
