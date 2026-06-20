import { registerTool } from "./registry.js";
import { resolveToolTradingContext } from "./trading-context.js";
import { contractMarginMode, contractOrderSide, contractPositionMode, contractPositionSide } from "./contract-context.js";
import { normalizeSymbol } from "../broker/symbols.js";

registerTool(
  "close_position",
  "Close a USDT linear contract position by symbol and side in paper or live mode. Omitting amount closes the full position.",
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
  ["exchange", "broker", "config", "memory", "sessionId"],
  async ({ exchange, broker, config, memory, sessionId, symbol, side, amount, order_type = "market", price }) => {
    try {
      if (side !== "long" && side !== "short") return "Error: side must be long or short";
      if (order_type === "limit" && !(price > 0)) return "Error: limit order requires a positive price";

      const normalized = normalizeSymbol(symbol, "swap");
      symbol = normalized.symbol;
      const ctx = resolveToolTradingContext(memory, sessionId);
      const positions = config?.paperTrading
        ? await (() => {
            if (!broker) throw new Error("paper broker is not initialized");
            return broker.fetchPositions(ctx.botId);
          })()
        : await (() => {
            if (!exchange) throw new Error("live exchange is not initialized");
            return exchange.fetchPositions();
          })();
      const pos = positions[`${symbol}:${side}`] ?? Object.values(positions).find((p: any) => p.symbol === symbol && p.side === side);
      if (!pos || !(pos.amount > 0)) return `Error: no ${side} position for ${symbol}`;
      const closeAmount = amount == null ? pos.amount : Number(amount);
      if (!(closeAmount > 0)) return "Error: amount must be > 0";
      const orderSide = contractOrderSide(side, true);

      const mode = config?.paperTrading ? "PAPER" : "LIVE";
      const result = config?.paperTrading
        ? await (() => {
            if (!broker) throw new Error("paper broker is not initialized");
            return broker.createOrder({
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
              agentRunId: ctx.agentRunId,
              mandateId: ctx.mandateId,
              capitalAllocationId: ctx.capitalAllocationId,
              botId: ctx.botId,
              tradingAccountId: ctx.tradingAccountId,
            });
          })()
        : await (() => {
            if (!exchange) throw new Error("live exchange is not initialized");
            return exchange.createOrder(
              symbol,
              orderSide,
              order_type,
              closeAmount,
              order_type === "limit" ? price : undefined,
              {
                marketType: "swap",
                positionMode: contractPositionMode(config),
                positionSide: contractPositionSide(config, side),
                marginMode: contractMarginMode(config),
                reduceOnly: true,
              },
            );
          })();

      if (result.error) return `[${mode}] Close position failed: ${result.error}`;
      memory?.logTrade?.(sessionId ?? "system", {
        symbol,
        side: orderSide,
        amount: closeAmount,
        price: result.price ?? pos.current_price ?? pos.avg_entry_price ?? 0,
        order_type,
        mode,
        reasoning: `[Contract] close ${side}`,
        agentRunId: ctx.agentRunId,
        mandateId: ctx.mandateId,
        capitalAllocationId: ctx.capitalAllocationId,
        botId: ctx.botId,
        tradingAccountId: ctx.tradingAccountId,
      });
      return `[${mode}] Close position ${result.status}:\n${JSON.stringify(result, null, 2)}`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
