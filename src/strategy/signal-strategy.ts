import { computeSma } from "../indicators.js";
import { evalCondition, updateCachedIndicators, type IndicatorSnapshot } from "./evaluator.js";
import { Strategy, type StrategyContext } from "./base.js";
import type { Tick, Candle } from "../market-feed.js";
import type { Signal, Condition } from "./state.js";

const MAX_CLOSES = 200;
const MIN_CLOSES_FOR_EVAL = 50;

/**
 * Indicator-triggered signal strategy. Equivalent to the old Condition-based
 * rule system: entry and exit are arrays of Conditions that must all be true.
 *
 * Per-instance state:
 *   - indicator cache (closes window + cached SMA/RSI/Bollinger)
 *   - lastPrice from ticker for entry/exit evaluation between candle closes
 *
 * Multiple SignalStrategy instances on the same (symbol, timeframe) share
 * no state — each maintains its own cache. This is wasteful for identical
 * timeframes but keeps the model simple; shared caching across instances is
 * a later optimization.
 */
export interface SignalStrategyParams {
  timeframe: string;
  side: "long" | "short";
  entry: Condition[];
  exit: Condition[];
  positionSizeUsdt: number;
  leverage?: number;
  stopLossPct: number;
  takeProfitPct: number;
}

export class SignalStrategy extends Strategy {
  readonly kind = "signal";
  private cache: IndicatorSnapshot;

  constructor(opts: {
    id: string;
    symbol: string;
    params: SignalStrategyParams;
    enabled?: boolean;
    allocatedUsdt?: number;
    createdAt?: string;
    updatedAt?: string;
  }) {
    super(opts);
    this.cache = { closes: [], lastPrice: 0, lastVolume: 0, prevSma20: 0, prevSma50: 0 };
  }

  get timeframe(): string {
    return (this.params as SignalStrategyParams).timeframe;
  }

  get side(): "long" | "short" {
    return (this.params as SignalStrategyParams).side;
  }

  get positionSizeUsdt(): number {
    return (this.params as SignalStrategyParams).positionSizeUsdt;
  }

  get leverage(): number | undefined {
    return (this.params as SignalStrategyParams).leverage;
  }

  get stopLossPct(): number {
    return (this.params as SignalStrategyParams).stopLossPct;
  }

  get takeProfitPct(): number {
    return (this.params as SignalStrategyParams).takeProfitPct;
  }

  requiredSubscriptions() {
    return [
      { type: "ticker" as const, symbol: this.symbol },
      { type: "ohlcv" as const, symbol: this.symbol, timeframe: this.timeframe },
    ];
  }

  start(ctx: StrategyContext): void {
    this.ctx = ctx;
    ctx.feed.subscribeTicker(this.symbol, (tick) => this.onTick(tick));
    ctx.feed.subscribeOhlcv(this.symbol, this.timeframe, (candle) => this.onCandle(candle));
  }

  stop(): void {
    // MarketFeed unsubscribes by symbol, done at daemon/engine level. Here
    // we just drop our internal state so further ticks are ignored.
    this.ctx = null;
  }

  /** Daemon calls this at startup to prime the indicator cache with historical closes. */
  seedHistory(closes: number[]): void {
    this.cache.closes = closes.slice(-MAX_CLOSES);
    if (closes.length > 0) this.cache.lastPrice = closes[closes.length - 1];
    updateCachedIndicators(this.cache);
  }

  onCandle(candle: Candle): void {
    if (candle.symbol !== this.symbol || candle.timeframe !== this.timeframe) return;

    const prevSma20 = computeSma(this.cache.closes, 20);
    const prevSma50 = computeSma(this.cache.closes, 50);
    this.cache.prevSma20 = prevSma20;
    this.cache.prevSma50 = prevSma50;

    this.cache.closes.push(candle.close);
    if (this.cache.closes.length > MAX_CLOSES) this.cache.closes.shift();
    this.cache.lastVolume = candle.volume;

    updateCachedIndicators(this.cache);
  }

  onTick(tick: Tick): void {
    if (!this.enabled || !this.ctx) return;
    if (tick.symbol !== this.symbol) return;
    this.cache.lastPrice = tick.last;
    if (this.cache.closes.length < MIN_CLOSES_FOR_EVAL) return;
    this.evaluate();
  }

  private evaluate(): void {
    if (!this.ctx) return;
    const p = this.params as SignalStrategyParams;

    const entryMet = p.entry.every((c) => evalCondition(c, this.cache));
    if (entryMet) {
      this.ctx.emitSignal({
        ruleId: this.id,
        symbol: this.symbol,
        side: this.side,
        action: "enter",
        sizeUsdt: p.positionSizeUsdt,
        reason: `Entry conditions met for strategy ${this.id.slice(0, 8)} on ${p.timeframe}`,
        timestamp: Date.now(),
        leverage: p.leverage,
        stopLossPct: p.stopLossPct,
        takeProfitPct: p.takeProfitPct,
      } satisfies Signal);
    }

    const exitMet = p.exit.every((c) => evalCondition(c, this.cache));
    if (exitMet) {
      this.ctx.emitSignal({
        ruleId: this.id,
        symbol: this.symbol,
        side: this.side,
        action: "exit",
        sizeUsdt: p.positionSizeUsdt,
        reason: `Exit conditions met for strategy ${this.id.slice(0, 8)} on ${p.timeframe}`,
        timestamp: Date.now(),
      } satisfies Signal);
    }
  }
}
