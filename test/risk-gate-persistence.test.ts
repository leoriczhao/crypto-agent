import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { Memory } from "../src/memory.js";
import { RiskGate } from "../src/strategy/risk-gate.js";
import { StrategyManager } from "../src/strategy/manager.js";
import { DEFAULT_RISK_PARAMS, type Signal } from "../src/strategy/state.js";

/**
 * The key property: daemon restart must NOT reset today's realized PnL.
 * Otherwise the daily-loss cap is a paper tiger.
 */

let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `crypto-riskgate-${randomUUID().slice(0, 8)}.db`);
});

afterEach(() => {
  if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
});

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    ruleId: "r",
    symbol: "BTC/USDT",
    side: "long",
    action: "enter",
    sizeUsdt: 500,
    reason: "test",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeExchange() {
  return {
    fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 10000, total: 10000 } }),
    fetchPositions: vi.fn().mockResolvedValue({}),
  } as any;
}

describe("RiskGate daily PnL persistence", () => {
  test("dailyPnl persists across RiskGate instances (simulating restart)", async () => {
    // --- First "daemon run": accumulate losses that exceed the 3% cap ---
    const memory1 = new Memory(dbPath);
    const store1 = new StrategyManager(memory1);
    store1.setRiskParams({ ...DEFAULT_RISK_PARAMS, maxDailyLossPct: 3 });
    const gate1 = new RiskGate({
      store: store1,
      exchange: makeExchange(),
      initialPortfolioValue: 10000,
      memory: memory1,
    });

    // 3.5% loss on a $10k baseline = $350 loss, exceeds 3% cap
    gate1.recordPnl(-200);
    gate1.recordPnl(-150);
    memory1.close();

    // --- "Daemon restart": new Memory, new RiskGate ---
    const memory2 = new Memory(dbPath);
    const store2 = new StrategyManager(memory2);
    const gate2 = new RiskGate({
      store: store2,
      exchange: makeExchange(),
      initialPortfolioValue: 10000,
      memory: memory2,
    });

    // Next evaluate should respect the accumulated loss and reject
    const decision = await gate2.evaluate(makeSignal());
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain("Daily loss");
    memory2.close();
  });

  test("peak watermark persists across restarts and protects drawdown calc", async () => {
    const memory1 = new Memory(dbPath);
    // Simulate account growing to $15k
    memory1.updatePortfolioWatermark(15000);
    memory1.close();

    // Restart — drawdown should now be computed against $15k peak,
    // not the $10k initialPortfolioValue passed to the constructor
    const memory2 = new Memory(dbPath);
    const store = new StrategyManager(memory2);
    store.setRiskParams({ ...DEFAULT_RISK_PARAMS, maxDrawdownPct: 20 });
    // Current portfolio is $11k (down from the $15k peak = 26.7% drawdown)
    const exchange = {
      fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 11000, total: 11000 } }),
      fetchPositions: vi.fn().mockResolvedValue({}),
    } as any;
    // initialPortfolioValue argument of 10000 would give 0 drawdown; the
    // persisted peak of 15000 should take precedence.
    const gate = new RiskGate({
      store,
      exchange,
      initialPortfolioValue: 10000,
      memory: memory2,
    });

    const decision = await gate.evaluate(makeSignal());
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain("drawdown");
    memory2.close();
  });

  test("new day is fresh (does not inherit yesterday's PnL)", async () => {
    const memory = new Memory(dbPath);
    // Use a date that is reliably in the past (30 days ago) so it can't
    // collide with today's ISO date regardless of timezone/system clock.
    const yesterday = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    expect(yesterday).not.toBe(today);

    memory.addDailyPnl(yesterday, -500);
    expect(memory.getDailyPnl(today)).toBe(0);
    expect(memory.getDailyPnl(yesterday)).toBe(-500);
    memory.close();
  });
});
