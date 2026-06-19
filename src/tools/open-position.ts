import { registerTool } from "./registry.js";
import { resolveToolTradingContext } from "./trading-context.js";

registerTool(
  "open_position",
  "Open a paper USDT linear contract position. Use this for paper futures/perpetual long/short positions, not spot buys.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "USDT contract symbol, e.g. BTC/USDT:USDT" },
      side: { type: "string", enum: ["long", "short"] },
      notional_usdt: { type: "number", description: "USDT notional exposure to open" },
      leverage: { type: "number", description: "Isolated leverage for the paper position" },
      order_type: { type: "string", enum: ["market", "limit"], default: "market" },
      price: { type: "number", description: "Limit price; also used for sizing limit orders" },
    },
    required: ["symbol", "side", "notional_usdt", "leverage"],
  },
  ["market_data", "broker", "config", "memory", "sessionId"],
  async ({ market_data, broker, config, memory, sessionId, symbol, side, notional_usdt, leverage, order_type = "market", price }) => {
    try {
      if (!config?.paperTrading) return "Error: contract trading is unsupported outside paper mode";
      if (!broker) return "Error: paper broker is not initialized";
      if (side !== "long" && side !== "short") return "Error: side must be long or short";
      if (!(notional_usdt > 0)) return "Error: notional_usdt must be > 0";
      const maxLev = config.paperMaxLeverage ?? 5;
      if (!(leverage > 0) || leverage > maxLev) {
        return `BLOCKED: leverage ${leverage}x exceeds paper max ${maxLev}x`;
      }
      if (order_type === "limit" && !(price > 0)) return "Error: limit order requires a positive price";

      const mark = order_type === "limit" ? Number(price) : Number((await market_data.fetchTicker(symbol)).last ?? 0);
      if (!(mark > 0)) return "Error: unable to price contract order";
      const amount = notional_usdt / mark;
      const ctx = resolveToolTradingContext(memory, sessionId);
      const orderSide = side === "long" ? "buy" : "sell";

      const result = await broker.createOrder({
        symbol,
        marketType: "swap",
        side: orderSide,
        positionSide: side,
        orderType: order_type,
        amount,
        price: order_type === "limit" ? price : undefined,
        notionalUsdt: notional_usdt,
        leverage,
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        botId: ctx.botId,
        tradingAccountId: ctx.tradingAccountId,
      });

      if (result.error) return `[PAPER] Open position failed: ${result.error}`;
      memory?.logTrade?.(sessionId ?? "system", {
        symbol,
        side: orderSide,
        amount,
        price: result.price ?? mark,
        order_type,
        mode: "PAPER",
        reasoning: `[Contract] open ${side} ${notional_usdt} USDT @ ${leverage}x`,
        botId: ctx.botId,
        tradingAccountId: ctx.tradingAccountId,
      });
      return `[PAPER] Open position ${result.status}:\n${JSON.stringify(result, null, 2)}`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
