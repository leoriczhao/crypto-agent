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
  ruleId: string;
  symbol: string;
  side: "long" | "short";
  action: "enter" | "exit";
  sizeUsdt: number;
  reason: string;
  timestamp: number;
}

// ── StrategyStore: in-memory + SQLite persistence ───────────────────────

export class StrategyStore {
  private rules = new Map<string, StrategyRule>();
  private _riskParams: RiskParams = { ...DEFAULT_RISK_PARAMS };
  private persistence: StrategyPersistence | null = null;

  constructor(persistence?: StrategyPersistence) {
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
    if (ok) this.persistence?.deleteRule(id);
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
