import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Strategy, type StrategySnapshot } from "./base.js";
import { SignalStrategy, type SignalStrategyParams } from "./signal-strategy.js";
import { LadderStrategy, type LadderStrategyParams } from "./ladder-strategy.js";
import { GridStrategy, type GridStrategyParams } from "./grid-strategy.js";
import { DEFAULT_RISK_PARAMS, type RiskParams } from "./state.js";
import type { Memory } from "../memory.js";

/**
 * Factory — new strategy kinds get added here. Keeps the switch centralized
 * so the persistence layer stays kind-agnostic (just stores JSON params).
 */
export function instantiateStrategy(snap: StrategySnapshot): Strategy {
  switch (snap.kind) {
    case "signal":
      return new SignalStrategy({
        id: snap.id,
        symbol: snap.symbol,
        params: snap.params as SignalStrategyParams,
        enabled: snap.enabled,
        allocatedUsdt: snap.allocatedUsdt,
        createdAt: snap.createdAt,
        updatedAt: snap.updatedAt,
      });
    case "ladder":
      return new LadderStrategy({
        id: snap.id,
        symbol: snap.symbol,
        params: snap.params as LadderStrategyParams,
        enabled: snap.enabled,
        allocatedUsdt: snap.allocatedUsdt,
        createdAt: snap.createdAt,
        updatedAt: snap.updatedAt,
      });
    case "grid":
      return new GridStrategy({
        id: snap.id,
        symbol: snap.symbol,
        params: snap.params as GridStrategyParams,
        enabled: snap.enabled,
        allocatedUsdt: snap.allocatedUsdt,
        createdAt: snap.createdAt,
        updatedAt: snap.updatedAt,
      });
    default:
      throw new Error(`Unknown strategy kind: ${snap.kind}`);
  }
}

/**
 * Persistence contract — Memory implements this.
 * Keeping it minimal; strategies are opaque (kind + JSON params) at this layer.
 */
export interface StrategyPersistence {
  saveStrategy(snap: StrategySnapshot): void;
  deleteStrategy(id: string): void;
  loadAllStrategies(): StrategySnapshot[];
  saveRiskParams(params: RiskParams): void;
  loadRiskParams(): RiskParams | null;
}

/**
 * Point-in-time budget snapshot for one strategy.
 * usedUsdt = current capital locked in open positions (from active_positions).
 * realizedPnl = sum of (sell_proceeds - buy_cost) from closed round-trips (trades table).
 */
export interface StrategyBudget {
  id: string;
  allocatedUsdt: number;
  usedUsdt: number;
  realizedPnl: number;
  openPositions: number;
}

/**
 * Replaces the old StrategyStore. Holds a typed Strategy instance per id
 * (instead of a POJO StrategyRule), plus the account-level RiskParams.
 *
 * Events:
 *   - "strategyAdded" (Strategy)
 *   - "strategyRemoved" (id: string)
 */
export class StrategyManager extends EventEmitter {
  private strategies = new Map<string, Strategy>();
  private _riskParams: RiskParams = { ...DEFAULT_RISK_PARAMS };
  private persistence: StrategyPersistence | null;
  /** Full Memory reference for budget accounting (trades + active_positions). */
  private memory: Memory | null;

  constructor(persistence?: StrategyPersistence & Partial<Memory>) {
    super();
    this.persistence = persistence ?? null;
    // Only keep Memory if it actually has the query methods we need.
    this.memory = persistence && typeof (persistence as any).loadActivePositions === "function"
      ? (persistence as any as Memory)
      : null;
    if (this.persistence) this.loadFromDb();
  }

  // ── Risk params ──────────────────────────────────────────────────────────

  get riskParams(): RiskParams {
    return { ...this._riskParams };
  }

  setRiskParams(params: Partial<RiskParams>): void {
    Object.assign(this._riskParams, params);
    this.persistence?.saveRiskParams(this._riskParams);
  }

  // ── Strategy CRUD ────────────────────────────────────────────────────────

  addStrategy(input: {
    id?: string;
    kind: string;
    symbol: string;
    params: Record<string, any>;
    allocatedUsdt?: number;
    enabled?: boolean;
  }): Strategy {
    const now = new Date().toISOString();
    const snap: StrategySnapshot = {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      symbol: input.symbol,
      params: input.params,
      enabled: input.enabled ?? true,
      allocatedUsdt: input.allocatedUsdt ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    const strat = instantiateStrategy(snap);
    this.strategies.set(strat.id, strat);
    this.persistence?.saveStrategy(snap);
    this.emit("strategyAdded", strat);
    return strat;
  }

  removeStrategy(id: string): boolean {
    const existed = this.strategies.delete(id);
    if (existed) {
      this.persistence?.deleteStrategy(id);
      this.emit("strategyRemoved", id);
    }
    return existed;
  }

  /**
   * Mutate a strategy's params in-place + persist. Useful for enable/disable
   * toggles. Rebuilds the Strategy instance because params may change its
   * subscriptions / internal state; the old instance should be stopped by
   * the caller before this is called.
   */
  updateStrategy(
    id: string,
    patch: Partial<Pick<StrategySnapshot, "params" | "enabled" | "allocatedUsdt">>,
  ): Strategy | null {
    const existing = this.strategies.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const snap: StrategySnapshot = {
      id: existing.id,
      kind: existing.kind,
      symbol: existing.symbol,
      params: patch.params ?? existing.params,
      enabled: patch.enabled ?? existing.enabled,
      allocatedUsdt: patch.allocatedUsdt ?? existing.allocatedUsdt,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    const fresh = instantiateStrategy(snap);
    this.strategies.set(id, fresh);
    this.persistence?.saveStrategy(snap);
    return fresh;
  }

  getStrategy(id: string): Strategy | undefined {
    return this.strategies.get(id);
  }

  getActiveStrategies(symbol?: string): Strategy[] {
    const all = [...this.strategies.values()].filter((s) => s.enabled);
    return symbol ? all.filter((s) => s.symbol === symbol) : all;
  }

  getAllStrategies(): Strategy[] {
    return [...this.strategies.values()];
  }

  // ── Budget accounting (B2) ──────────────────────────────────────────────

  /**
   * USDT locked in CLOSED-BOOK positions only (active_positions rows).
   * Does not count pending limit orders — used for PnL accounting where
   * only filled capital should contribute.
   */
  private getCostInActivePositions(strategyId: string): number {
    if (!this.memory) return 0;
    let cost = 0;
    for (const p of this.memory.loadActivePositions()) {
      const owner = p.strategyId ?? p.ruleId;
      if (owner === strategyId) cost += p.entryPrice * p.amount;
    }
    return cost;
  }

  /**
   * USDT the strategy is obligated to (filled + resting).
   * Used by TradeGuard to enforce the strategy's allocation cap. Pending
   * limit orders must be included, otherwise a strategy can oversize by
   * stacking many resting orders (e.g. grid with N levels at $X each).
   */
  getUsedUsdt(strategyId: string): number {
    if (!this.memory) return 0;
    let used = this.getCostInActivePositions(strategyId);
    for (const o of this.memory.getOpenPendingOrdersByStrategy(strategyId)) {
      if (o.action === "enter" && o.price != null) {
        used += o.price * o.amount;
      }
    }
    return used;
  }

  /**
   * Realized PnL for this strategy: buy + sell cost round-trips on every
   * closed position. Implemented as (sum of sell_proceeds) - (sum of buy_costs).
   * The imbalance (currently open cost) nets out correctly only when all
   * trades have been closed; for in-flight positions this returns an
   * approximate "committed PnL so far" including unrealized entry cost.
   */
  getRealizedPnl(strategyId: string): number {
    if (!this.memory) return 0;
    const trades = this.memory.getTradesByStrategy(strategyId);
    let buys = 0;
    let sells = 0;
    for (const t of trades) {
      const notional = t.amount * t.price;
      if (t.side === "buy") buys += notional;
      else sells += notional;
    }
    // sells - buys on matched round-trips = net realized. Entries with no
    // matching exit show as negative (capital still in a live position);
    // adding back the active-position cost nets that out so only fully
    // closed cycles count. Pending limit orders must NOT be added back —
    // they haven't produced a 'buy' trade row yet.
    const rawNet = sells - buys;
    return rawNet + this.getCostInActivePositions(strategyId);
  }

  getBudget(strategyId: string): StrategyBudget | null {
    const strat = this.strategies.get(strategyId);
    if (!strat) return null;
    const used = this.getUsedUsdt(strategyId);
    const pnl = this.getRealizedPnl(strategyId);
    const positions = this.memory?.loadActivePositions() ?? [];
    const openPositions = positions.filter((p) => (p.strategyId ?? p.ruleId) === strategyId).length;
    return {
      id: strategyId,
      allocatedUsdt: strat.allocatedUsdt,
      usedUsdt: used,
      realizedPnl: pnl,
      openPositions,
    };
  }

  listBudgets(): StrategyBudget[] {
    return this.getAllStrategies()
      .map((s) => this.getBudget(s.id))
      .filter((b): b is StrategyBudget => b !== null);
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────

  private loadFromDb(): void {
    if (!this.persistence) return;
    const rp = this.persistence.loadRiskParams();
    if (rp) this._riskParams = rp;
    for (const snap of this.persistence.loadAllStrategies()) {
      try {
        const strat = instantiateStrategy(snap);
        this.strategies.set(snap.id, strat);
      } catch (e: any) {
        console.warn(`[StrategyManager] skipping strategy ${snap.id}: ${e.message ?? e}`);
      }
    }
  }
}
