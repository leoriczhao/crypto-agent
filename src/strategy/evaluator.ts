import { computeSma, computeRsi, computeBollinger } from "../indicators.js";
import type { Condition } from "./state.js";

/**
 * Shared indicator snapshot used by both SignalEngine (live) and BacktestEngine (historical).
 * Keeping one definition ensures identical evaluation logic across both paths.
 *
 * Cached fields (prefixed `cached`) are populated once per candle close by
 * `updateCachedIndicators()`. Tick-level evaluation uses cached values to avoid
 * recomputing O(window) indicators on every tick.
 */
export interface IndicatorSnapshot {
  closes: number[];
  lastPrice: number;
  lastVolume: number;
  prevSma20: number;
  prevSma50: number;
  // Cached indicators — updated per candle, not per tick
  cachedRsi14?: number;
  cachedSma20?: number;
  cachedSma50?: number;
  cachedBollingerLower?: number;
  cachedBollingerUpper?: number;
}

/**
 * Recompute all cached indicator values from the current closes array.
 * Call this once per candle close (not per tick).
 */
export function updateCachedIndicators(snap: IndicatorSnapshot): void {
  snap.cachedRsi14 = computeRsi(snap.closes, 14);
  snap.cachedSma20 = computeSma(snap.closes, 20);
  snap.cachedSma50 = computeSma(snap.closes, 50);
  const [lower, , upper] = computeBollinger(snap.closes, 20, 2);
  snap.cachedBollingerLower = lower;
  snap.cachedBollingerUpper = upper;
}

export function evalCondition(cond: Condition, snap: IndicatorSnapshot): boolean {
  const val = computeIndicatorValue(cond, snap);
  if (val === null) return false;

  switch (cond.operator) {
    case "gt": return val > cond.value;
    case "lt": return val < cond.value;
    case "gte": return val >= cond.value;
    case "lte": return val <= cond.value;
    case "cross_above": return checkCrossAbove(cond, snap);
    case "cross_below": return checkCrossBelow(cond, snap);
    default: return false;
  }
}

export function computeIndicatorValue(cond: Condition, snap: IndicatorSnapshot): number | null {
  const { closes, lastPrice, lastVolume } = snap;
  switch (cond.indicator) {
    case "rsi": {
      const period = cond.params?.period ?? 14;
      // Use cache for default period
      if (period === 14 && snap.cachedRsi14 !== undefined) return snap.cachedRsi14;
      return computeRsi(closes, period);
    }
    case "sma_cross": {
      const shortPeriod = cond.params?.short ?? 20;
      const longPeriod = cond.params?.long ?? 50;
      // Use cache for default periods
      const shortVal = (shortPeriod === 20 && snap.cachedSma20 !== undefined)
        ? snap.cachedSma20
        : computeSma(closes, shortPeriod);
      const longVal = (longPeriod === 50 && snap.cachedSma50 !== undefined)
        ? snap.cachedSma50
        : computeSma(closes, longPeriod);
      return shortVal && longVal ? shortVal - longVal : null;
    }
    case "bollinger": {
      const period = cond.params?.period ?? 20;
      const stdDev = cond.params?.stdDev ?? 2;
      let lower: number, upper: number;
      // Use cache for default params
      if (period === 20 && stdDev === 2 && snap.cachedBollingerLower !== undefined && snap.cachedBollingerUpper !== undefined) {
        lower = snap.cachedBollingerLower;
        upper = snap.cachedBollingerUpper;
      } else {
        const [l, , u] = computeBollinger(closes, period, stdDev);
        lower = l;
        upper = u;
      }
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

export function checkCrossAbove(cond: Condition, snap: IndicatorSnapshot): boolean {
  if (cond.indicator !== "sma_cross") return false;
  const shortPeriod = cond.params?.short ?? 20;
  const longPeriod = cond.params?.long ?? 50;
  const shortNow = (shortPeriod === 20 && snap.cachedSma20 !== undefined)
    ? snap.cachedSma20
    : computeSma(snap.closes, shortPeriod);
  const longNow = (longPeriod === 50 && snap.cachedSma50 !== undefined)
    ? snap.cachedSma50
    : computeSma(snap.closes, longPeriod);
  if (!shortNow || !longNow) return false;
  const prevDiff = snap.prevSma20 - snap.prevSma50;
  const nowDiff = shortNow - longNow;
  return prevDiff <= 0 && nowDiff > 0;
}

export function checkCrossBelow(cond: Condition, snap: IndicatorSnapshot): boolean {
  if (cond.indicator !== "sma_cross") return false;
  const shortPeriod = cond.params?.short ?? 20;
  const longPeriod = cond.params?.long ?? 50;
  const shortNow = (shortPeriod === 20 && snap.cachedSma20 !== undefined)
    ? snap.cachedSma20
    : computeSma(snap.closes, shortPeriod);
  const longNow = (longPeriod === 50 && snap.cachedSma50 !== undefined)
    ? snap.cachedSma50
    : computeSma(snap.closes, longPeriod);
  if (!shortNow || !longNow) return false;
  const prevDiff = snap.prevSma20 - snap.prevSma50;
  const nowDiff = shortNow - longNow;
  return prevDiff >= 0 && nowDiff < 0;
}
