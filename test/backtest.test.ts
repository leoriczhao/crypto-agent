import { describe, test, expect } from "vitest";
import { BacktestEngine, type BacktestResult } from "../src/backtest.js";

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
