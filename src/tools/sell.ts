import { registerTool } from "./registry.js";
import { checkTradeAllowed } from "../trade-guard.js";
import { DEFAULT_RISK_PARAMS } from "../strategy/state.js";
import { withTradeLock } from "../trade-lock.js";
import { resolveToolTradingContext } from "./trading-context.js";

registerTool(
  "sell",
  "Sell cryptocurrency. Places a market or limit sell order. Enforces risk limits (soul constraints, exposure, drawdown).",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT" },
      amount: { type: "number", description: "Quantity of base currency to sell" },
      order_type: { type: "string", enum: ["market", "limit"], default: "market" },
      price: { type: "number", description: "Limit price (required for limit orders)" },
    },
    required: ["symbol", "amount"],
  },
  ["exchange", "market_data", "config", "memory", "sessionId", "soul", "strategy_store", "broker"],
  async ({ exchange, market_data, config, memory, sessionId, soul, strategy_store, broker, symbol, amount, order_type = "market", price }) => {
    try {
      if (amount <= 0) return "Error: amount must be > 0";
      if (config.paperTrading && !broker) return "Error: paper broker is not initialized";
      const ticker = await market_data.fetchTicker(symbol);
      const cost = ticker.last * amount;
      const riskParams = strategy_store?.riskParams ?? DEFAULT_RISK_PARAMS;
      const watermark = memory?.getPortfolioWatermark?.();
      const baseline = watermark?.peakValue ?? (config.initialBalance.USDT ?? 10000);
      const today = new Date().toISOString().slice(0, 10);
      const dailyPnl = memory?.getDailyPnl?.(today);

      return await withTradeLock(`sell ${symbol} ${amount}`, async () => {
        const guard = await checkTradeAllowed(
          {
            exchange,
            broker: config.paperTrading ? broker : undefined,
            botId: resolveToolTradingContext(memory, sessionId).botId,
            riskParams,
            soulMaxPositionPct: soul?.max_position_pct ?? 20,
            maxOrderSizeUsdt: config.maxOrderSizeUsdt,
            initialBalanceUsdt: baseline,
            dailyPnl,
          },
          symbol,
          "sell",
          cost,
        );
        if (!guard.allowed) return `BLOCKED: ${guard.reason}`;

        const mode = config.paperTrading ? "PAPER" : "LIVE";

        const pendingId = memory?.createPendingOrder?.({
          sessionId,
          symbol,
          side: "sell",
          orderType: order_type,
          price: order_type === "limit" ? price : null,
          amount,
        }) ?? null;

        const ctx = resolveToolTradingContext(memory, sessionId);
        const result = config.paperTrading
          ? await broker.createOrder({
              symbol,
              marketType: "spot",
              side: "sell",
              orderType: order_type,
              amount,
              price: order_type === "limit" ? price ?? null : null,
              actorType: ctx.actorType,
              actorId: ctx.actorId,
              botId: ctx.botId,
              tradingAccountId: ctx.tradingAccountId,
            })
          : await exchange.createOrder(symbol, "sell", order_type, amount, price);
        if (result.error) {
          if (pendingId !== null) memory?.updatePendingOrder?.(pendingId, { status: "unknown" });
          return `[${mode}] Sell failed: ${result.error}`;
        }

        if (pendingId !== null) {
          const finalStatus = order_type === "market" ? "filled" : "open";
          memory?.updatePendingOrder?.(pendingId, {
            exchangeOrderId: result.id ?? null,
            status: finalStatus,
          });
        }

        if (memory && sessionId) {
          memory.logTrade?.(sessionId, {
            symbol,
            side: "sell",
            amount,
            price: result.price ?? ticker.last,
            order_type,
            mode,
          });
        }

        const warnings = guard.warnings.length ? `\nWarnings: ${guard.warnings.join("; ")}` : "";
        return `[${mode}] Sell order filled:\n${JSON.stringify(result, null, 2)}${warnings}`;
      });
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
