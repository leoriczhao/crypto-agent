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
  ["exchange", "broker", "config"],
  async ({ exchange, broker, config, order_id, symbol }) => {
    try {
      if (config?.paperTrading) {
        if (!broker) return "Error: paper broker is not initialized";
        const result = await broker.cancelOrder(order_id, symbol);
        return JSON.stringify(result, null, 2);
      }
      if (!exchange) return "Error: live exchange is not initialized";
      const result = await exchange.cancelOrder(order_id, symbol);
      return JSON.stringify(result, null, 2);
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
