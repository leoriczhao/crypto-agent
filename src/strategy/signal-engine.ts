import { EventEmitter } from "node:events";
import { computeSma, computeRsi, computeBollinger } from "../indicators.js";
import type { MarketFeed, Tick, Candle } from "../market-feed.js";
import type { StrategyStore, StrategyRule, Condition, Signal } from "./state.js";

const MAX_CLOSES = 200;

interface IndicatorCache {
  closes: number[];
  lastPrice: number;
  lastVolume: number;
  prevSma20: number;
  prevSma50: number;
}

export class SignalEngine extends EventEmitter {
  private feed: MarketFeed;
  private store: StrategyStore;
  private caches = new Map<string, IndicatorCache>();
  private running = false;

  constructor(feed: MarketFeed, store: StrategyStore) {
    super();
    this.feed = feed;
    this.store = store;
  }

  start(symbols: string[]): void {
    this.running = true;
    for (const sym of symbols) {
      this.caches.set(sym, { closes: [], lastPrice: 0, lastVolume: 0, prevSma20: 0, prevSma50: 0 });
      this.feed.subscribeTicker(sym, (tick) => this.onTick(tick));
      this.feed.subscribeOhlcv(sym, "1m", (candle) => this.onCandle(candle));
    }
  }

  stop(): void {
    this.running = false;
    for (const sym of this.caches.keys()) {
      this.feed.unsubscribe(sym);
    }
    this.caches.clear();
  }

  seedHistory(symbol: string, closes: number[]): void {
    const cache = this.caches.get(symbol);
    if (cache) {
      cache.closes = closes.slice(-MAX_CLOSES);
      if (closes.length > 0) cache.lastPrice = closes[closes.length - 1];
    }
  }

  private onCandle(candle: Candle): void {
    if (!this.running) return;
    const cache = this.caches.get(candle.symbol);
    if (!cache) return;

    const prevSma20 = computeSma(cache.closes, 20);
    const prevSma50 = computeSma(cache.closes, 50);
    cache.prevSma20 = prevSma20;
    cache.prevSma50 = prevSma50;

    cache.closes.push(candle.close);
    if (cache.closes.length > MAX_CLOSES) cache.closes.shift();
    cache.lastVolume = candle.volume;
  }

  private onTick(tick: Tick): void {
    if (!this.running) return;
    const cache = this.caches.get(tick.symbol);
    if (!cache) return;
    cache.lastPrice = tick.last;

    const rules = this.store.getActiveRules(tick.symbol);
    for (const rule of rules) {
      this.evaluateRule(rule, cache);
    }
  }

  private evaluateRule(rule: StrategyRule, cache: IndicatorCache): void {
    if (cache.closes.length < 50) return;

    const entryMet = rule.entry.every((c) => this.evalCondition(c, cache));
    if (entryMet) {
      const signal: Signal = {
        ruleId: rule.id,
        symbol: rule.symbol,
        side: rule.side,
        action: "enter",
        sizeUsdt: rule.positionSizeUsdt,
        reason: `Entry conditions met for rule ${rule.id.slice(0, 8)}`,
        timestamp: Date.now(),
      };
      this.emit("signal", signal);
    }

    const exitMet = rule.exit.every((c) => this.evalCondition(c, cache));
    if (exitMet) {
      const signal: Signal = {
        ruleId: rule.id,
        symbol: rule.symbol,
        side: rule.side,
        action: "exit",
        sizeUsdt: rule.positionSizeUsdt,
        reason: `Exit conditions met for rule ${rule.id.slice(0, 8)}`,
        timestamp: Date.now(),
      };
      this.emit("signal", signal);
    }
  }

  evalCondition(cond: Condition, cache: IndicatorCache): boolean {
    const val = this.computeIndicatorValue(cond, cache);
    if (val === null) return false;

    switch (cond.operator) {
      case "gt": return val > cond.value;
      case "lt": return val < cond.value;
      case "gte": return val >= cond.value;
      case "lte": return val <= cond.value;
      case "cross_above": return this.checkCrossAbove(cond, cache);
      case "cross_below": return this.checkCrossBelow(cond, cache);
      default: return false;
    }
  }

  private computeIndicatorValue(cond: Condition, cache: IndicatorCache): number | null {
    const { closes, lastPrice, lastVolume } = cache;
    switch (cond.indicator) {
      case "rsi":
        return computeRsi(closes, cond.params?.period ?? 14);
      case "sma_cross": {
        const short = computeSma(closes, cond.params?.short ?? 20);
        const long = computeSma(closes, cond.params?.long ?? 50);
        return short && long ? short - long : null;
      }
      case "bollinger": {
        const [lower, , upper] = computeBollinger(closes, cond.params?.period ?? 20, cond.params?.stdDev ?? 2);
        if (!lower) return null;
        return cond.value >= 0 ? lastPrice - upper : lastPrice - lower;
      }
      case "price_level":
        return lastPrice;
      case "volume":
        return lastVolume;
      default:
        return null;
    }
  }

  private checkCrossAbove(cond: Condition, cache: IndicatorCache): boolean {
    if (cond.indicator !== "sma_cross") return false;
    const shortNow = computeSma(cache.closes, cond.params?.short ?? 20);
    const longNow = computeSma(cache.closes, cond.params?.long ?? 50);
    if (!shortNow || !longNow) return false;
    const prevDiff = cache.prevSma20 - cache.prevSma50;
    const nowDiff = shortNow - longNow;
    return prevDiff <= 0 && nowDiff > 0;
  }

  private checkCrossBelow(cond: Condition, cache: IndicatorCache): boolean {
    if (cond.indicator !== "sma_cross") return false;
    const shortNow = computeSma(cache.closes, cond.params?.short ?? 20);
    const longNow = computeSma(cache.closes, cond.params?.long ?? 50);
    if (!shortNow || !longNow) return false;
    const prevDiff = cache.prevSma20 - cache.prevSma50;
    const nowDiff = shortNow - longNow;
    return prevDiff >= 0 && nowDiff < 0;
  }
}
