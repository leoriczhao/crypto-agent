import { randomUUID } from "node:crypto";

// ── Condition: a single predicate evaluated against market data ──────────

export type IndicatorType = "rsi" | "sma_cross" | "bollinger" | "price_level" | "volume";
export type Operator = "gt" | "lt" | "gte" | "lte" | "cross_above" | "cross_below";

export interface Condition {
  indicator: IndicatorType;
  operator: Operator;
  value: number;
  params?: Record<string, number>;
}

// ── StrategyRule: a complete entry/exit ruleset for one symbol ───────────

export interface StrategyRule {
  id: string;
  symbol: string;
  timeframe: string; // "1m" | "5m" | "15m" | "1h" | "4h" | "1d" — must match the backtest timeframe used to validate this rule
  side: "long" | "short";
  entry: Condition[];
  exit: Condition[];
  positionSizeUsdt: number;
  stopLossPct: number;
  takeProfitPct: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── RiskParams: hard constraints the RiskGate enforces ──────────────────

export interface RiskParams {
  maxPositionPct: number;
  maxExposurePct: number;
  maxDrawdownPct: number;
  maxDailyLossPct: number;
  maxConcurrentPositions: number;
}

export const DEFAULT_RISK_PARAMS: RiskParams = {
  maxPositionPct: 20,
  maxExposurePct: 60,
  maxDrawdownPct: 20,
  maxDailyLossPct: 5,
  maxConcurrentPositions: 5,
};

// ── Signal: output of SignalEngine, input to RiskGate ───────────────────

export interface Signal {
  /** Owning Strategy id. Same value in every signal from one strategy — used
   * for budget attribution, event routing, and strategyId in trades/positions. */
  ruleId: string;
  symbol: string;
  side: "long" | "short";
  action: "enter" | "exit";
  sizeUsdt: number;
  reason: string;
  timestamp: number;
  /** Unique position id for this leg. Defaults to ruleId when a strategy
   * only ever holds one position at a time (SignalStrategy). Strategies that
   * run multiple simultaneous positions (Ladder, future Grid) generate
   * distinct positionIds per leg so OrderExecutor can track them separately. */
  positionId?: string;
  /** Optional per-signal SL/TP in percent. Set by strategies that compute
   * their own exit bands (e.g. SignalStrategy). Absent = executor relies on
   * strategy-emitted exit signals. */
  stopLossPct?: number;
  takeProfitPct?: number;
  /** How the executor should submit this order. Default "market" = fill at
   * current ticker. "limit" requires a limitPrice and rests on the book
   * until price touches (or until the strategy cancels). */
  orderType?: "market" | "limit";
  limitPrice?: number;
}

// ── StrategyStore: in-memory + SQLite persistence ───────────────────────

import { EventEmitter } from "node:events";

export class StrategyStore extends EventEmitter {
  private rules = new Map<string, StrategyRule>();
  private _riskParams: RiskParams = { ...DEFAULT_RISK_PARAMS };
  private persistence: StrategyPersistence | null = null;

  constructor(persistence?: StrategyPersistence) {
    super();
    this.persistence = persistence ?? null;
    if (this.persistence) this.loadFromDb();
  }

  get riskParams(): RiskParams {
    return { ...this._riskParams };
  }

  setRiskParams(params: Partial<RiskParams>): void {
    Object.assign(this._riskParams, params);
    this.persistence?.saveRiskParams(this._riskParams);
  }

  addRule(rule: Omit<StrategyRule, "id" | "createdAt" | "updatedAt">): StrategyRule {
    const now = new Date().toISOString();
    const full: StrategyRule = { id: randomUUID(), createdAt: now, updatedAt: now, ...rule };
    this.rules.set(full.id, full);
    this.persistence?.saveRule(full);
    this.emit("ruleAdded", full);
    return full;
  }

  updateRule(id: string, patch: Partial<StrategyRule>): StrategyRule | null {
    const existing = this.rules.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.rules.set(id, updated);
    this.persistence?.saveRule(updated);
    return updated;
  }

  removeRule(id: string): boolean {
    const ok = this.rules.delete(id);
    if (ok) {
      this.persistence?.deleteRule(id);
      this.emit("ruleRemoved", id);
    }
    return ok;
  }

  getRule(id: string): StrategyRule | undefined {
    return this.rules.get(id);
  }

  getActiveRules(symbol?: string): StrategyRule[] {
    const all = [...this.rules.values()].filter((r) => r.enabled);
    return symbol ? all.filter((r) => r.symbol === symbol) : all;
  }

  getAllRules(): StrategyRule[] {
    return [...this.rules.values()];
  }

  private loadFromDb(): void {
    if (!this.persistence) return;
    const rp = this.persistence.loadRiskParams();
    if (rp) this._riskParams = rp;
    for (const rule of this.persistence.loadAllRules()) {
      if (!rule.timeframe) {
        // Legacy rules predate the timeframe field. Default to 1h and warn — the operator
        // should /delete_rule and re-run /research so the rule carries the timeframe the
        // strategist actually validated.
        rule.timeframe = "1h";
        console.warn(`[StrategyStore] rule ${rule.id.slice(0, 8)} has no timeframe; defaulted to 1h. Delete and re-create it for correct evaluation.`);
      }
      this.rules.set(rule.id, rule);
    }
  }
}

// ── Persistence interface (implemented by Memory) ───────────────────────

export interface StrategyPersistence {
  saveRule(rule: StrategyRule): void;
  deleteRule(id: string): void;
  loadAllRules(): StrategyRule[];
  saveRiskParams(params: RiskParams): void;
  loadRiskParams(): RiskParams | null;
}
