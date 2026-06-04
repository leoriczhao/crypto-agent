import { EventEmitter } from "node:events";
import { computeSma } from "../indicators.js";
import { evalCondition, updateCachedIndicators, type IndicatorSnapshot } from "./evaluator.js";
import type { MarketFeed, Tick, Candle } from "../market-feed.js";
import type { StrategyStore, StrategyRule, Signal } from "./state.js";

const MAX_CLOSES = 200;

function cacheKey(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}

function newSnapshot(): IndicatorSnapshot {
  return { closes: [], lastPrice: 0, lastVolume: 0, prevSma20: 0, prevSma50: 0 };
}

export class SignalEngine extends EventEmitter {
  private feed: MarketFeed;
  private store: StrategyStore;
  // Keyed by `${symbol}:${timeframe}` — rules on the same symbol but different
  // timeframes get independent indicator state.
  private caches = new Map<string, IndicatorSnapshot>();
  private running = false;
  private subscribed = new Set<string>(); // (symbol,timeframe) pairs we've told MarketFeed to watch
  private tickerSymbols = new Set<string>();

  constructor(feed: MarketFeed, store: StrategyStore) {
    super();
    this.feed = feed;
    this.store = store;
  }

  /**
   * Subscribe to every (symbol, timeframe) pair any active rule needs, plus
   * one ticker per symbol so entry/exit can respond between candle closes.
   */
  start(rules: StrategyRule[]): void {
    this.running = true;
    for (const rule of rules) {
      this.ensureSubscribed(rule.symbol, rule.timeframe);
    }
  }

  /** Add subscriptions for a newly created rule without restarting. */
  ensureSubscribed(symbol: string, timeframe: string): void {
    const key = cacheKey(symbol, timeframe);
    if (!this.caches.has(key)) this.caches.set(key, newSnapshot());
    if (!this.subscribed.has(key)) {
      this.subscribed.add(key);
      this.feed.subscribeOhlcv(symbol, timeframe, (candle) => this.onCandle(candle));
    }
    if (!this.tickerSymbols.has(symbol)) {
      this.tickerSymbols.add(symbol);
      this.feed.subscribeTicker(symbol, (tick) => this.onTick(tick));
    }
  }

  stop(): void {
    this.running = false;
    for (const sym of this.tickerSymbols) this.feed.unsubscribe(sym);
    this.caches.clear();
    this.subscribed.clear();
    this.tickerSymbols.clear();
  }

  seedHistory(symbol: string, timeframe: string, closes: number[]): void {
    const cache = this.caches.get(cacheKey(symbol, timeframe));
    if (!cache) return;
    cache.closes = closes.slice(-MAX_CLOSES);
    if (closes.length > 0) cache.lastPrice = closes[closes.length - 1];
    updateCachedIndicators(cache);
  }

  /** Symbol+timeframe pairs this engine currently tracks (for diagnostics). */
  get watchedKeys(): string[] {
    return [...this.subscribed];
  }

  private onCandle(candle: Candle): void {
    if (!this.running) return;
    const cache = this.caches.get(cacheKey(candle.symbol, candle.timeframe));
    if (!cache) return;

    const prevSma20 = computeSma(cache.closes, 20);
    const prevSma50 = computeSma(cache.closes, 50);
    cache.prevSma20 = prevSma20;
    cache.prevSma50 = prevSma50;

    cache.closes.push(candle.close);
    if (cache.closes.length > MAX_CLOSES) cache.closes.shift();
    cache.lastVolume = candle.volume;

    updateCachedIndicators(cache);
  }

  private onTick(tick: Tick): void {
    if (!this.running) return;
    // A tick on a symbol updates lastPrice across ALL timeframe caches for that
    // symbol — the in-progress candle close is effectively the latest tick price.
    for (const [key, cache] of this.caches) {
      if (key.startsWith(`${tick.symbol}:`)) {
        cache.lastPrice = tick.last;
      }
    }

    const rules = this.store.getActiveRules(tick.symbol);
    for (const rule of rules) {
      const cache = this.caches.get(cacheKey(rule.symbol, rule.timeframe));
      if (!cache) continue;
      this.evaluateRule(rule, cache);
    }
  }

  private evaluateRule(rule: StrategyRule, cache: IndicatorSnapshot): void {
    if (cache.closes.length < 50) return;

    const entryMet = rule.entry.every((c) => evalCondition(c, cache));
    if (entryMet) {
      this.emit("signal", {
        ruleId: rule.id,
        symbol: rule.symbol,
        side: rule.side,
        action: "enter",
        sizeUsdt: rule.positionSizeUsdt,
        reason: `Entry conditions met for rule ${rule.id.slice(0, 8)} on ${rule.timeframe}`,
        timestamp: Date.now(),
      } satisfies Signal);
    }

    const exitMet = rule.exit.every((c) => evalCondition(c, cache));
    if (exitMet) {
      this.emit("signal", {
        ruleId: rule.id,
        symbol: rule.symbol,
        side: rule.side,
        action: "exit",
        sizeUsdt: rule.positionSizeUsdt,
        reason: `Exit conditions met for rule ${rule.id.slice(0, 8)} on ${rule.timeframe}`,
        timestamp: Date.now(),
      } satisfies Signal);
    }
  }
}
