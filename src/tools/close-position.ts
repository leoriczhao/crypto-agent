import { registerTool } from "./registry.js";
import { resolveToolTradingContext } from "./trading-context.js";

registerTool(
  "close_position",
  "Close a paper USDT linear contract position by symbol and side. Omitting amount closes the full position.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "USDT contract symbol, e.g. BTC/USDT:USDT" },
      side: { type: "string", enum: ["long", "short"] },
      amount: { type: "number", description: "Contract/base amount to close; omit for full close" },
      order_type: { type: "string", enum: ["market", "limit"], default: "market" },
      price: { type: "number", description: "Limit close price" },
    },
    required: ["symbol", "side"],
  },
  ["broker", "config", "memory", "sessionId"],
  async ({ broker, config, memory, sessionId, symbol, side, amount, order_type = "market", price }) => {
    try {
      if (!config?.paperTrading) return "Error: contract trading is unsupported outside paper mode";
      if (!broker) return "Error: paper broker is not initialized";
      if (side !== "long" && side !== "short") return "Error: side must be long or short";
      if (order_type === "limit" && !(price > 0)) return "Error: limit order requires a positive price";

      const ctx = resolveToolTradingContext(memory, sessionId);
      const positions = await broker.fetchPositions(ctx.botId);
      const pos = positions[`${symbol}:${side}`] ?? Object.values(positions).find((p: any) => p.symbol === symbol && p.side === side);
      if (!pos || !(pos.amount > 0)) return `Error: no ${side} position for ${symbol}`;
      const closeAmount = amount == null ? pos.amount : Number(amount);
      if (!(closeAmount > 0)) return "Error: amount must be > 0";
      const orderSide = side === "long" ? "sell" : "buy";

      const result = await broker.createOrder({
        symbol,
        marketType: "swap",
        side: orderSide,
        positionSide: side,
        orderType: order_type,
        amount: closeAmount,
        price: order_type === "limit" ? price : undefined,
        reduceOnly: true,
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        botId: ctx.botId,
        tradingAccountId: ctx.tradingAccountId,
      });

      if (result.error) return `[PAPER] Close position failed: ${result.error}`;
      memory?.logTrade?.(sessionId ?? "system", {
        symbol,
        side: orderSide,
        amount: closeAmount,
        price: result.price ?? pos.current_price ?? pos.avg_entry_price ?? 0,
        order_type,
        mode: "PAPER",
        reasoning: `[Contract] close ${side}`,
        botId: ctx.botId,
        tradingAccountId: ctx.tradingAccountId,
      });
      return `[PAPER] Close position ${result.status}:\n${JSON.stringify(result, null, 2)}`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
