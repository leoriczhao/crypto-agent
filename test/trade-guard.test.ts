import { describe, test, expect, vi } from "vitest";
import { checkTradeAllowed, type TradeGuardContext } from "../src/trade-guard.js";
import { DEFAULT_RISK_PARAMS } from "../src/strategy/state.js";

function makeCtx(overrides: Partial<TradeGuardContext> = {}): TradeGuardContext {
  return {
    exchange: {
      fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 10000, used: 0, total: 10000 } }),
      fetchPositions: vi.fn().mockResolvedValue({}),
    } as any,
    riskParams: { ...DEFAULT_RISK_PARAMS },
    soulMaxPositionPct: 20,
    maxOrderSizeUsdt: 1000,
    initialBalanceUsdt: 10000,
    ...overrides,
  };
}

describe("checkTradeAllowed", () => {
  test("allows normal trade within limits", async () => {
    const result = await checkTradeAllowed(makeCtx(), "BTC/USDT", "buy", 500);
    expect(result.allowed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("rejects order exceeding max order size", async () => {
    const result = await checkTradeAllowed(makeCtx(), "BTC/USDT", "buy", 1500);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("exceeds max");
  });

  test("uses riskParams.maxPositionPct by default", async () => {
    // riskParams default = 20%, soul cap = 100% (not restrictive)
    const ctx = makeCtx({
      maxOrderSizeUsdt: 5000,
      soulMaxPositionPct: 100,
    });
    // 2500 / 10000 = 25% > 20%
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 2500);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("risk params");
  });

  test("soul ceiling wins when more restrictive than riskParams", async () => {
    // riskParams default 20%, but soul caps at 10%
    const ctx = makeCtx({
      maxOrderSizeUsdt: 5000,
      soulMaxPositionPct: 10,
    });
    // 1500 / 10000 = 15% > soul 10%
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 1500);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("soul ceiling");
  });

  test("riskParams wins when more restrictive than soul", async () => {
    // riskParams tightened to 5%, soul more permissive at 40%
    const ctx = makeCtx({
      riskParams: { ...DEFAULT_RISK_PARAMS, maxPositionPct: 5 },
      maxOrderSizeUsdt: 5000,
      soulMaxPositionPct: 40,
    });
    // 800 / 10000 = 8% > riskParams 5%
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 800);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("risk params");
  });

  test("respects configurable maxExposurePct", async () => {
    const ctx = makeCtx({
      riskParams: { ...DEFAULT_RISK_PARAMS, maxExposurePct: 40 }, // tightened from 60
      maxOrderSizeUsdt: 10000,
      soulMaxPositionPct: 100,
      initialBalanceUsdt: 7000,
      exchange: {
        fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 4000, total: 4000 } }),
        fetchPositions: vi.fn().mockResolvedValue({
          "ETH/USDT:long": { amount: 1, current_price: 3000, avg_entry_price: 3000 },
        }),
      } as any,
    });
    // portfolio=7000, existing exposure=3000 (42.9%), +500 → 50% > 40%
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 500);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("40% limit");
  });

  test("respects configurable maxDrawdownPct", async () => {
    const ctx = makeCtx({
      riskParams: { ...DEFAULT_RISK_PARAMS, maxDrawdownPct: 10 }, // tightened from 20
      exchange: {
        fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 8500, total: 8500 } }),
        fetchPositions: vi.fn().mockResolvedValue({}),
      } as any,
    });
    // drawdown = 15% > 10%
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("drawdown");
    expect(result.reason).toContain("10% limit");
  });

  test("enforces dailyLoss when dailyPnl provided", async () => {
    const ctx = makeCtx({
      riskParams: { ...DEFAULT_RISK_PARAMS, maxDailyLossPct: 3 },
      dailyPnl: -500, // $500 loss on $10k = 5% > 3%
    });
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily loss");
  });

  test("skips dailyLoss check when dailyPnl omitted", async () => {
    const ctx = makeCtx(); // no dailyPnl
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 100);
    expect(result.allowed).toBe(true);
  });

  test("enforces maxConcurrentPositions", async () => {
    const ctx = makeCtx({
      riskParams: { ...DEFAULT_RISK_PARAMS, maxConcurrentPositions: 2 },
      soulMaxPositionPct: 100,
      maxOrderSizeUsdt: 10000,
      initialBalanceUsdt: 10000,
      exchange: {
        fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 7000, total: 7000 } }),
        fetchPositions: vi.fn().mockResolvedValue({
          "ETH/USDT:long": { amount: 1, current_price: 1500, avg_entry_price: 1500 },
          "SOL/USDT:long": { amount: 10, current_price: 150, avg_entry_price: 150 },
        }),
      } as any,
    });
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 300);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("max is 2");
  });

  test("warns when approaching position limit", async () => {
    // Soul cap = 20, 17% = 85% of cap → warning
    const ctx = makeCtx({ maxOrderSizeUsdt: 2000, soulMaxPositionPct: 20 });
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 1700);
    expect(result.allowed).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("near");
  });

  test("sells skip buy-only checks (position/exposure/balance)", async () => {
    const ctx = makeCtx({
      exchange: {
        fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 100, total: 100 } }),
        fetchPositions: vi.fn().mockResolvedValue({
          "BTC/USDT:long": { amount: 0.008, current_price: 50000, avg_entry_price: 48000 },
        }),
      } as any,
      initialBalanceUsdt: 500,
    });
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "sell", 400);
    expect(result.allowed).toBe(true);
  });

  test("drawdown check applies to sells too", async () => {
    const ctx = makeCtx({
      riskParams: { ...DEFAULT_RISK_PARAMS, maxDrawdownPct: 20 },
      exchange: {
        fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 7000, total: 7000 } }),
        fetchPositions: vi.fn().mockResolvedValue({}),
      } as any,
    });
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "sell", 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("drawdown");
  });

  test("handles exchange error gracefully", async () => {
    const ctx = makeCtx({
      exchange: {
        fetchBalance: vi.fn().mockRejectedValue(new Error("network timeout")),
        fetchPositions: vi.fn().mockResolvedValue({}),
      } as any,
    });
    const result = await checkTradeAllowed(ctx, "BTC/USDT", "buy", 500);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("network timeout");
  });
});
