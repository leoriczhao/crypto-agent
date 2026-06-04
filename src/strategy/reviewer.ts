import type { Memory, TradeRow } from "../memory.js";
import type { StrategyManager } from "./manager.js";

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
  private store: StrategyManager;
  private reviewIntervalTrades: number;
  private tradesSinceLastReview = 0;

  constructor(memory: Memory, store: StrategyManager, reviewEveryNTrades = 10) {
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
    const strategies = this.store.getAllStrategies();
    const riskParams = this.store.riskParams;

    const tradesText = trades.length
      ? trades.map((t) => formatTrade(t)).join("\n")
      : "(No trades recorded yet)";

    const rulesText = strategies.length
      ? strategies.map((s) => {
        const status = s.enabled ? "ON" : "OFF";
        const p = s.params as Record<string, any>;
        const side = p.side ?? "?";
        const size = p.positionSizeUsdt ?? 0;
        const sl = p.stopLossPct ?? 0;
        const tp = p.takeProfitPct ?? 0;
        const tf = p.timeframe ?? "?";
        return `[${status}] ${s.id.slice(0, 8)} kind=${s.kind} | ${s.symbol}@${tf} ${side} | $${size} | SL:${sl}% TP:${tp}%`;
      }).join("\n")
      : "(No strategies configured)";

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
