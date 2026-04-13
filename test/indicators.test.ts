import { describe, test, expect } from "vitest";
import { computeSma, computeRsi, computeBollinger } from "../src/indicators.js";

describe("computeSma", () => {
  test("sma of 1..20 with period 20", () => {
    const closes = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(computeSma(closes, 20)).toBe(10.5);
  });

  test("returns 0 with insufficient data", () => {
    expect(computeSma([1, 2], 20)).toBe(0);
  });
});

describe("computeRsi", () => {
  test("all gains → RSI 100", () => {
    const closes = Array.from({ length: 15 }, (_, i) => 100 + i);
    expect(computeRsi(closes)).toBe(100.0);
  });

  test("all losses → RSI 0", () => {
    const closes = Array.from({ length: 15 }, (_, i) => 114 - i);
    expect(computeRsi(closes)).toBe(0.0);
  });
});

describe("computeBollinger", () => {
  test("flat line returns equal bands", () => {
    const closes = Array.from({ length: 20 }, () => 10.0);
    const [lower, mid, upper] = computeBollinger(closes);
    expect(mid).toBe(10.0);
    expect(lower).toBe(10.0);
    expect(upper).toBe(10.0);
  });
});
