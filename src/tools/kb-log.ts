import { registerTool } from "./registry.js";

registerTool(
  "kb_log",
  "Log a strategy research outcome to the KB. Call this after you run a backtest on a hypothesis — ALWAYS log whether the result was good or bad. Logging failures is essential; future research retrieves failure reasons to avoid repeating dead ends.",
  {
    type: "object",
    properties: {
      hypothesis: {
        type: "string",
        description: "One-sentence description of what you tested (e.g. 'BTC SMA20/50 golden cross long on 1h')",
      },
      symbol: { type: "string", description: "Trading pair tested, e.g. BTC/USDT" },
      timeframe: { type: "string", description: "Candle timeframe, e.g. 1h / 4h / 1d" },
      backtest_summary: {
        type: "string",
        description: "Key metrics from your backtest: trades, win rate, Sharpe, max drawdown, PnL. Keep under 300 chars.",
      },
      outcome: {
        type: "string",
        enum: ["adopted", "rejected", "pending_review"],
        description: "adopted = rule created; rejected = hypothesis failed validation; pending_review = wants human sign-off",
      },
      failure_reason: {
        type: "string",
        description: "If rejected, one sentence on WHY (overfit / too few trades / bad Sharpe / market regime mismatch etc). REQUIRED when outcome='rejected'.",
      },
      rule_id: {
        type: "string",
        description: "If adopted, the strategy_rule id that was created",
      },
    },
    required: ["hypothesis", "outcome"],
  },
  ["memory"],
  async ({ memory, hypothesis, symbol, timeframe, backtest_summary, outcome, failure_reason, rule_id }) => {
    if (!memory) return "Error: memory unavailable";
    if (outcome === "rejected" && !failure_reason) {
      return "Error: failure_reason is required when outcome='rejected'. Say *why* it failed so future research can learn.";
    }
    try {
      const id = memory.logResearch({
        hypothesis,
        symbol: symbol ?? null,
        timeframe: timeframe ?? null,
        backtestSummary: backtest_summary ?? null,
        outcome,
        failureReason: failure_reason ?? null,
        ruleId: rule_id ?? null,
      });
      return `KB entry #${id} logged (${outcome}).`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
