import type { Memory, TradeRow } from "../memory.js";
import type { StrategyStore } from "./state.js";

const REVIEW_PROMPT_TEMPLATE = `You are a trading performance reviewer. Analyze these recent automated trades and provide actionable feedback.

## Recent Trades (newest first)
{trades}

## Current Strategy Rules
{rules}

## Current Risk Parameters
{risk_params}

## Task
1. Calculate overall win rate, average P&L, and risk-reward ratio
2. Identify which rules are performing well vs poorly
3. Suggest specific parameter adjustments (stop-loss %, take-profit %, position size)
4. Flag any patterns (e.g. consecutive losses, overtrading, poor timing)
5. If a rule is consistently losing, recommend disabling it

Output your analysis concisely. For parameter changes, use the manage_rules or plan_strategy tools.`;

export class TradeReviewer {
  private memory: Memory;
  private store: StrategyStore;
  private reviewIntervalTrades: number;
  private tradesSinceLastReview = 0;

  constructor(memory: Memory, store: StrategyStore, reviewEveryNTrades = 10) {
    this.memory = memory;
    this.store = store;
    this.reviewIntervalTrades = reviewEveryNTrades;
  }

  recordTrade(): boolean {
    this.tradesSinceLastReview++;
    return this.tradesSinceLastReview >= this.reviewIntervalTrades;
  }

  buildReviewPrompt(tradeCount = 20): string {
    const trades = this.memory.getRecentTrades(tradeCount);
    const rules = this.store.getAllRules();
    const riskParams = this.store.riskParams;

    const tradesText = trades.length
      ? trades.map((t) => formatTrade(t)).join("\n")
      : "(No trades recorded yet)";

    const rulesText = rules.length
      ? rules.map((r) => {
        const status = r.enabled ? "ON" : "OFF";
        return `[${status}] ${r.id.slice(0, 8)} | ${r.symbol} ${r.side} | $${r.positionSizeUsdt} | SL:${r.stopLossPct}% TP:${r.takeProfitPct}%`;
      }).join("\n")
      : "(No rules configured)";

    const rpText = [
      `Max Position: ${riskParams.maxPositionPct}%`,
      `Max Exposure: ${riskParams.maxExposurePct}%`,
      `Max Drawdown: ${riskParams.maxDrawdownPct}%`,
      `Max Daily Loss: ${riskParams.maxDailyLossPct}%`,
      `Max Positions: ${riskParams.maxConcurrentPositions}`,
    ].join("\n");

    this.tradesSinceLastReview = 0;

    return REVIEW_PROMPT_TEMPLATE
      .replace("{trades}", tradesText)
      .replace("{rules}", rulesText)
      .replace("{risk_params}", rpText);
  }

  saveReviewResult(sessionId: string, summary: string): void {
    this.memory.saveSessionSummary(sessionId, `[Trade Review] ${summary.slice(0, 2000)}`);
  }
}

function formatTrade(t: TradeRow): string {
  const ts = t.created_at.slice(0, 16).replace("T", " ");
  return `${ts} | ${t.side.toUpperCase().padEnd(4)} ${t.amount.toFixed(6)} ${t.symbol} @ ${t.price} | ${t.mode} | ${t.reasoning}`;
}
