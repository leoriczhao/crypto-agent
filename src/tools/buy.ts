import { registerTool } from "./registry.js";
import { checkTradeAllowed } from "../trade-guard.js";
import { DEFAULT_RISK_PARAMS } from "../strategy/state.js";
import { withTradeLock } from "../trade-lock.js";
import { resolveToolTradingContext } from "./trading-context.js";

registerTool(
  "buy",
  "Buy cryptocurrency. Places a market or limit buy order. Enforces risk limits (soul constraints, exposure, drawdown).",
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
  ["exchange", "market_data", "config", "memory", "sessionId", "soul", "strategy_store", "broker"],
  async ({ exchange, market_data, config, memory, sessionId, soul, strategy_store, broker, symbol, amount, order_type = "market", price }) => {
    try {
      if (amount <= 0) return "Error: amount must be > 0";
      if (config.paperTrading && !broker) return "Error: paper broker is not initialized";
      const ticker = await market_data.fetchTicker(symbol);
      const cost = ticker.last * amount;
      const riskParams = strategy_store?.riskParams ?? DEFAULT_RISK_PARAMS;

      // Baseline for drawdown = peak watermark if available, else configured initial.
      const watermark = memory?.getPortfolioWatermark?.();
      const baseline = watermark?.peakValue ?? (config.initialBalance.USDT ?? 10000);
      const today = new Date().toISOString().slice(0, 10);
      const dailyPnl = memory?.getDailyPnl?.(today);

      // Serialize risk-check + order-placement — prevents concurrent sessions
      // (or LLM vs fast-path) from racing on the same account.
      return await withTradeLock(`buy ${symbol} ${amount}`, async () => {
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
          "buy",
          cost,
        );
        if (!guard.allowed) return `BLOCKED: ${guard.reason}`;

        const mode = config.paperTrading ? "PAPER" : "LIVE";

        // Record intent before sending — if we crash between here and the
        // exchange response, restart will find a 'open' row to reconcile.
        const pendingId = memory?.createPendingOrder?.({
          sessionId,
          symbol,
          side: "buy",
          orderType: order_type,
          price: order_type === "limit" ? price : null,
          amount,
        }) ?? null;

        const ctx = resolveToolTradingContext(memory, sessionId);
        const result = config.paperTrading
          ? await broker.createOrder({
              symbol,
              marketType: "spot",
              side: "buy",
              orderType: order_type,
              amount,
              price: order_type === "limit" ? price ?? null : null,
              actorType: ctx.actorType,
              actorId: ctx.actorId,
              agentRunId: ctx.agentRunId,
              mandateId: ctx.mandateId,
              capitalAllocationId: ctx.capitalAllocationId,
              botId: ctx.botId,
              tradingAccountId: ctx.tradingAccountId,
            })
          : await exchange.createOrder(symbol, "buy", order_type, amount, price);
        if (result.error) {
          if (pendingId !== null) memory?.updatePendingOrder?.(pendingId, { status: "unknown" });
          return `[${mode}] Buy failed: ${result.error}`;
        }

        if (pendingId !== null) {
          // Market orders fill immediately → 'filled'; limit may sit 'open'.
          const finalStatus = order_type === "market" ? "filled" : "open";
          memory?.updatePendingOrder?.(pendingId, {
            exchangeOrderId: result.id ?? null,
            status: finalStatus,
          });
        }

        if (memory && sessionId) {
          memory.logTrade?.(sessionId, {
            symbol,
            side: "buy",
            amount,
            price: result.price ?? ticker.last,
            order_type,
            mode,
            agentRunId: ctx.agentRunId,
            mandateId: ctx.mandateId,
            capitalAllocationId: ctx.capitalAllocationId,
            botId: ctx.botId,
            tradingAccountId: ctx.tradingAccountId,
          });
        }

        const warnings = guard.warnings.length ? `\nWarnings: ${guard.warnings.join("; ")}` : "";
        return `[${mode}] Buy order filled:\n${JSON.stringify(result, null, 2)}${warnings}`;
      });
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
