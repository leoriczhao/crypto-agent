import { describe, test, expect } from "vitest";
import { evalCondition, computeIndicatorValue, checkCrossAbove, checkCrossBelow, type IndicatorSnapshot } from "../src/strategy/evaluator.js";
import type { Condition } from "../src/strategy/state.js";

// Rising price series: 100, 101, 102, ... (RSI should be high)
const risingCloses = Array.from({ length: 60 }, (_, i) => 100 + i);
// Falling price series: 200, 199, 198, ... (RSI should be low)
const fallingCloses = Array.from({ length: 60 }, (_, i) => 200 - i);
// Oscillating series for Bollinger tests
const oscillatingCloses = Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i * 0.5));

function makeSnap(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    closes: risingCloses,
    lastPrice: risingCloses[risingCloses.length - 1],
    lastVolume: 1000,
    prevSma20: 0,
    prevSma50: 0,
    ...overrides,
  };
}

describe("evalCondition", () => {
  test("rsi gt threshold", () => {
    const cond: Condition = { indicator: "rsi", operator: "gt", value: 50 };
    // Rising closes → RSI should be high
    expect(evalCondition(cond, makeSnap())).toBe(true);
  });

  test("rsi lt threshold on falling series", () => {
    const cond: Condition = { indicator: "rsi", operator: "lt", value: 50 };
    const snap = makeSnap({ closes: fallingCloses, lastPrice: fallingCloses[fallingCloses.length - 1] });
    expect(evalCondition(cond, snap)).toBe(true);
  });

  test("price_level gt", () => {
    const cond: Condition = { indicator: "price_level", operator: "gt", value: 100 };
    expect(evalCondition(cond, makeSnap({ lastPrice: 150 }))).toBe(true);
    expect(evalCondition(cond, makeSnap({ lastPrice: 50 }))).toBe(false);
  });

  test("price_level lte", () => {
    const cond: Condition = { indicator: "price_level", operator: "lte", value: 100 };
    expect(evalCondition(cond, makeSnap({ lastPrice: 100 }))).toBe(true);
    expect(evalCondition(cond, makeSnap({ lastPrice: 101 }))).toBe(false);
  });

  test("volume gte", () => {
    const cond: Condition = { indicator: "volume", operator: "gte", value: 500 };
    expect(evalCondition(cond, makeSnap({ lastVolume: 1000 }))).toBe(true);
    expect(evalCondition(cond, makeSnap({ lastVolume: 100 }))).toBe(false);
  });

  test("sma_cross gt 0 on rising series (short > long)", () => {
    const cond: Condition = { indicator: "sma_cross", operator: "gt", value: 0, params: { short: 10, long: 30 } };
    // In a rising series, short SMA > long SMA
    expect(evalCondition(cond, makeSnap())).toBe(true);
  });

  test("returns false for unknown indicator", () => {
    const cond: Condition = { indicator: "unknown" as any, operator: "gt", value: 0 };
    expect(evalCondition(cond, makeSnap())).toBe(false);
  });

  test("returns false for unknown operator", () => {
    const cond: Condition = { indicator: "price_level", operator: "unknown" as any, value: 100 };
    expect(evalCondition(cond, makeSnap({ lastPrice: 150 }))).toBe(false);
  });

  test("returns false when insufficient data", () => {
    const cond: Condition = { indicator: "rsi", operator: "gt", value: 50 };
    // RSI returns 50 for insufficient data, 50 is not > 50 → false
    expect(evalCondition(cond, makeSnap({ closes: [100, 101, 102] }))).toBe(false);
    // RSI with 3 closes returns 50 (default), which is not > 50
    // Actually computeRsi returns 50 when insufficient data, so it equals 50 → not gt → false
    // Let's just verify it doesn't crash:
    const result = evalCondition(cond, makeSnap({ closes: [100] }));
    expect(typeof result).toBe("boolean");
  });
});

describe("computeIndicatorValue", () => {
  test("rsi returns a number in 0-100", () => {
    const cond: Condition = { indicator: "rsi", operator: "gt", value: 0 };
    const val = computeIndicatorValue(cond, makeSnap());
    expect(val).not.toBeNull();
    expect(val!).toBeGreaterThanOrEqual(0);
    expect(val!).toBeLessThanOrEqual(100);
  });

  test("sma_cross returns short-long difference", () => {
    const cond: Condition = { indicator: "sma_cross", operator: "gt", value: 0, params: { short: 10, long: 30 } };
    const val = computeIndicatorValue(cond, makeSnap());
    expect(val).not.toBeNull();
    // In a rising series, short SMA > long SMA → positive difference
    expect(val!).toBeGreaterThan(0);
  });

  test("bollinger returns relative price position", () => {
    const cond: Condition = { indicator: "bollinger", operator: "gt", value: 0, params: { period: 20, stdDev: 2 } };
    const val = computeIndicatorValue(cond, makeSnap({ closes: oscillatingCloses, lastPrice: 110 }));
    expect(val).not.toBeNull();
  });
});

describe("checkCrossAbove / checkCrossBelow", () => {
  test("cross_above detects golden cross", () => {
    const cond: Condition = { indicator: "sma_cross", operator: "cross_above", value: 0, params: { short: 20, long: 50 } };
    // prevSma20 < prevSma50 (dead cross), now sma20 > sma50 (golden cross)
    const snap = makeSnap({ prevSma20: 95, prevSma50: 100 });
    // With rising closes, current sma20 > sma50
    expect(checkCrossAbove(cond, snap)).toBe(true);
  });

  test("cross_above returns false if no cross happened", () => {
    const cond: Condition = { indicator: "sma_cross", operator: "cross_above", value: 0, params: { short: 20, long: 50 } };
    // prevSma20 > prevSma50 (already golden), still golden → not a NEW cross
    const snap = makeSnap({ prevSma20: 105, prevSma50: 100 });
    expect(checkCrossAbove(cond, snap)).toBe(false);
  });

  test("cross_below detects death cross", () => {
    const cond: Condition = { indicator: "sma_cross", operator: "cross_below", value: 0, params: { short: 20, long: 50 } };
    // prevSma20 > prevSma50, now short < long on falling series
    const snap = makeSnap({
      closes: fallingCloses,
      lastPrice: fallingCloses[fallingCloses.length - 1],
      prevSma20: 180,
      prevSma50: 175,
    });
    expect(checkCrossBelow(cond, snap)).toBe(true);
  });

  test("cross functions return false for non sma_cross indicator", () => {
    const cond: Condition = { indicator: "rsi", operator: "cross_above", value: 0 };
    expect(checkCrossAbove(cond, makeSnap())).toBe(false);
    expect(checkCrossBelow(cond, makeSnap())).toBe(false);
  });
});
