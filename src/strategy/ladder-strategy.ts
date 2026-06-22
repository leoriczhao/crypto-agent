import { Strategy, type StrategyContext } from "./base.js";
import type { Tick } from "../market-feed.js";
import type { Signal } from "./state.js";

export interface LadderLevel {
  triggerPrice: number;
  sizeUsdt: number;
}

export interface LadderStrategyParams {
  side: "long" | "short";
  /** Ordered entry levels. Long: triggerPrice DESCENDING (buy more as price drops).
   *  Short: triggerPrice ASCENDING (sell more as price rises). */
  levels: LadderLevel[];
  /** Combined take-profit (percent from weighted avg entry). */
  takeProfitPct: number;
  /** Optional combined stop-loss (percent from weighted avg entry). */
  stopLossPct?: number;
}

interface OpenLeg {
  positionId: string;
  entryPrice: number;
  amount: number; // in base asset units (BTC)
  sizeUsdt: number; // notional at entry
}

/**
 * Multi-level entry ladder. Scales into a combined position as price touches
 * each configured level, then exits the whole stack at a single weighted
 * take-profit. An early validation ground for the Strategy abstraction: it
 * exercises multiple simultaneous positions, per-leg positionIds, and
 * strategy-internal state management — things SignalStrategy doesn't need.
 *
 * Execution model (long side):
 *   - For each level (in order), once tick.last ≤ triggerPrice and that level
 *     hasn't been filled, emit an `enter` signal with positionId=L{idx}.
 *   - Executor fills it; Runtime calls onOrderFilled → we record the leg.
 *   - On every tick, if combined avg entry × (1 + tpPct/100) ≤ tick.last,
 *     emit `exit` for every open leg (combined take-profit).
 *   - Optional stopLossPct = aggregate drawdown guard.
 */
export class LadderStrategy extends Strategy {
  readonly kind = "ladder";

  private filledLevels = new Set<number>(); // level indices that already triggered
  private openLegs = new Map<string, OpenLeg>();
  private exitFiredAt: number | null = null; // timestamp of last exit broadcast, for de-dup

  constructor(opts: {
    id: string;
    symbol: string;
    params: LadderStrategyParams;
    enabled?: boolean;
    allocatedUsdt?: number;
    botId?: string | null;
    tradingAccountId?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }) {
    super(opts);
  }

  get side(): "long" | "short" {
    return (this.params as LadderStrategyParams).side;
  }

  get levels(): LadderLevel[] {
    return (this.params as LadderStrategyParams).levels;
  }

  get takeProfitPct(): number {
    return (this.params as LadderStrategyParams).takeProfitPct;
  }

  get stopLossPct(): number | undefined {
    return (this.params as LadderStrategyParams).stopLossPct;
  }

  requiredSubscriptions() {
    // Ladder only needs price ticks — it evaluates purely against price levels.
    return [{ type: "ticker" as const, symbol: this.symbol }];
  }

  start(ctx: StrategyContext): void {
    this.ctx = ctx;
    ctx.feed.subscribeTicker(this.symbol, (tick) => this.onTick(tick));
  }

  stop(): void {
    this.ctx = null;
  }

  /** Weighted average entry across all open legs. Returns null if no open legs. */
  combinedAvgEntry(): number | null {
    if (this.openLegs.size === 0) return null;
    let totalCost = 0;
    let totalAmount = 0;
    for (const leg of this.openLegs.values()) {
      totalCost += leg.entryPrice * leg.amount;
      totalAmount += leg.amount;
    }
    return totalAmount > 0 ? totalCost / totalAmount : null;
  }

  onTick(tick: Tick): void {
    if (!this.enabled || !this.ctx) return;
    if (tick.symbol !== this.symbol) return;

    // 1. Try to fill any untouched levels whose trigger has been hit.
    const levels = this.levels;
    for (let i = 0; i < levels.length; i++) {
      if (this.filledLevels.has(i)) continue;
      const lvl = levels[i];
      const triggered = this.side === "long"
        ? tick.last <= lvl.triggerPrice
        : tick.last >= lvl.triggerPrice;
      if (!triggered) continue;

      this.filledLevels.add(i);
      const positionId = `${this.id}:L${i}`;
      this.ctx.emitSignal({
        ruleId: this.id,
        positionId,
        symbol: this.symbol,
        side: this.side,
        action: "enter",
        sizeUsdt: lvl.sizeUsdt,
        reason: `Ladder level ${i} triggered at ${tick.last} (≤ ${lvl.triggerPrice})`,
        timestamp: Date.now(),
        // Per-leg passive SL/TP disabled — Ladder computes combined exits in onTick.
      } satisfies Signal);
    }

    // 2. Evaluate combined take-profit / stop-loss against current tick.
    this.evaluateCombinedExits(tick.last);
  }

  private evaluateCombinedExits(lastPrice: number): void {
    if (!this.ctx) return;
    if (this.openLegs.size === 0) return;

    // De-dup: once we fire exits for all legs, skip until state clears.
    // `exitFiredAt` is reset in onOrderFilled(exit) when openLegs drains.
    if (this.exitFiredAt !== null) return;

    const avg = this.combinedAvgEntry();
    if (avg == null) return;
    const tp = this.takeProfitPct;
    const sl = this.stopLossPct;

    let triggered: "tp" | "sl" | null = null;
    if (this.side === "long") {
      if (lastPrice >= avg * (1 + tp / 100)) triggered = "tp";
      else if (sl != null && lastPrice <= avg * (1 - sl / 100)) triggered = "sl";
    } else {
      if (lastPrice <= avg * (1 - tp / 100)) triggered = "tp";
      else if (sl != null && lastPrice >= avg * (1 + sl / 100)) triggered = "sl";
    }

    if (!triggered) return;

    this.exitFiredAt = Date.now();
    for (const leg of this.openLegs.values()) {
      this.ctx.emitSignal({
        ruleId: this.id,
        positionId: leg.positionId,
        symbol: this.symbol,
        side: this.side,
        action: "exit",
        sizeUsdt: leg.sizeUsdt,
        reason: `Ladder combined ${triggered === "tp" ? "take-profit" : "stop-loss"} at ${lastPrice} (avg entry ${avg.toFixed(2)})`,
        timestamp: Date.now(),
      } satisfies Signal);
    }
  }

  onOrderFilled(order: Record<string, any>): void {
    // Runtime forwards executor fills here. Two cases: enter (add leg) and
    // exit (remove leg).
    if (order.action === "enter") {
      const positionId = order.positionId as string;
      const entryPrice = order.entryPrice as number;
      const amount = order.amount as number;
      const sizeUsdt = entryPrice * amount;
      this.openLegs.set(positionId, { positionId, entryPrice, amount, sizeUsdt });
    } else if (order.action === "exit") {
      const positionId = order.positionId as string;
      this.openLegs.delete(positionId);
      if (this.openLegs.size === 0) {
        // All legs closed — ready to arm a new cycle if levels re-trigger.
        this.exitFiredAt = null;
      }
    }
  }

  /** For testing / introspection. */
  get openLegCount(): number {
    return this.openLegs.size;
  }

  get filledLevelIndices(): number[] {
    return [...this.filledLevels].sort((a, b) => a - b);
  }
}
