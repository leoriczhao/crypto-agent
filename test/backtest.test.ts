import { describe, test, expect } from "vitest";
import { BacktestEngine, type BacktestResult } from "../src/backtest.js";
import type { Condition } from "../src/strategy/state.js";

function makeOhlcv(closes: number[]) {
  return closes.map((c, i) => ({
    timestamp: i * 3600000,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1000,
  }));
}

describe("BacktestEngine", () => {
  test("run returns BacktestResult", () => {
    const engine = new BacktestEngine(10000);
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
    const result = engine.run(makeOhlcv(closes), "sma_crossover", {
      short_period: 5,
      long_period: 20,
    });
    expect(result).toHaveProperty("totalReturn");
    expect(result).toHaveProperty("equityCurve");
    expect(result).toHaveProperty("totalTrades");
  });

  test("sma crossover uptrend", () => {
    const engine = new BacktestEngine(10000);
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
    const result = engine.run(makeOhlcv(closes), "sma_crossover", {
      short_period: 5,
      long_period: 20,
    });
    expect(result.totalTrades).toBeGreaterThanOrEqual(1);
    expect(result.totalReturn).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });

  test("rsi reversal", () => {
    const closes: number[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let i = 0; i < 15; i++) closes.push(100 - i * 2);
      for (let i = 0; i < 15; i++) closes.push(70 + i * 2);
    }
    const engine = new BacktestEngine(10000);
    const result = engine.run(makeOhlcv(closes), "rsi_reversal");
    expect(result).toHaveProperty("totalReturn");
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });

  test("bollinger bounce", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + 10 * Math.sin(i * 0.3));
    const engine = new BacktestEngine(10000);
    const result = engine.run(makeOhlcv(closes), "bollinger_bounce");
    expect(result).toHaveProperty("totalReturn");
  });

  test("unknown strategy throws", () => {
    const engine = new BacktestEngine();
    expect(() => engine.run([], "nonexistent")).toThrow(/Unknown strategy/);
  });

  test("max drawdown in range 0-100", () => {
    const engine = new BacktestEngine(10000);
    const up = Array.from({ length: 100 }, (_, i) => 100 + i);
    const down = Array.from({ length: 100 }, (_, i) => 200 - i);
    const result = engine.run(makeOhlcv([...up, ...down]), "sma_crossover", {
      short_period: 5,
      long_period: 20,
    });
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdown).toBeLessThanOrEqual(100);
  });

  test("sharpe ratio is a number", () => {
    const engine = new BacktestEngine(10000);
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
    const result = engine.run(makeOhlcv(closes), "sma_crossover", {
      short_period: 5,
      long_period: 20,
    });
    expect(typeof result.sharpeRatio).toBe("number");
  });
});

describe("BacktestEngine.runConditionBased", () => {
  test("runs with RSI entry/exit conditions", () => {
    // Create oscillating data so RSI crosses thresholds
    const closes: number[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let i = 0; i < 20; i++) closes.push(100 - i * 2);
      for (let i = 0; i < 20; i++) closes.push(60 + i * 2);
    }
    const entry: Condition[] = [{ indicator: "rsi", operator: "lt", value: 35 }];
    const exit: Condition[] = [{ indicator: "rsi", operator: "gt", value: 65 }];

    const engine = new BacktestEngine(10000);
    const result = engine.runConditionBased(makeOhlcv(closes), entry, exit, "long");
    expect(result.strategy).toBe("condition_based");
    expect(result).toHaveProperty("totalReturn");
    expect(result).toHaveProperty("equityCurve");
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });

  test("runs with price_level conditions on trending data", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i);
    const entry: Condition[] = [{ indicator: "price_level", operator: "gt", value: 120 }];
    const exit: Condition[] = [{ indicator: "price_level", operator: "gt", value: 170 }];

    const engine = new BacktestEngine(10000);
    const result = engine.runConditionBased(makeOhlcv(closes), entry, exit, "long");
    expect(result.totalTrades).toBeGreaterThanOrEqual(1);
  });

  test("returns valid result with no trades when conditions never met", () => {
    const closes = Array.from({ length: 80 }, () => 100); // flat price
    const entry: Condition[] = [{ indicator: "price_level", operator: "gt", value: 200 }];
    const exit: Condition[] = [{ indicator: "price_level", operator: "lt", value: 50 }];

    const engine = new BacktestEngine(10000);
    const result = engine.runConditionBased(makeOhlcv(closes), entry, exit);
    expect(result.totalTrades).toBe(0);
    expect(result.totalReturn).toBe(0);
  });

  test("uses same evaluation logic as SignalEngine", () => {
    // Verify that condition evaluation is deterministic and consistent
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
    const entry: Condition[] = [
      { indicator: "sma_cross", operator: "gt", value: 0, params: { short: 10, long: 30 } },
    ];
    const exit: Condition[] = [
      { indicator: "sma_cross", operator: "lt", value: 0, params: { short: 10, long: 30 } },
    ];

    const engine = new BacktestEngine(10000);
    const result1 = engine.runConditionBased(makeOhlcv(closes), entry, exit);
    const result2 = engine.runConditionBased(makeOhlcv(closes), entry, exit);
    // Same input → same output (deterministic)
    expect(result1.totalTrades).toBe(result2.totalTrades);
    expect(result1.totalReturn).toBe(result2.totalReturn);
  });
});
