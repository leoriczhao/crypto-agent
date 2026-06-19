import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { Memory } from "../src/memory.js";
import { OrderExecutor } from "../src/strategy/executor.js";
import { StrategyStore } from "../src/strategy/state.js";

/**
 * Integration: OrderExecutor's restore() must match locally-saved positions
 * against the live exchange and only retain those the exchange still knows
 * about. This is the critical correctness path for recovering stop-loss
 * management after a daemon restart.
 */

let dbPath: string;
let memory: Memory;

beforeEach(() => {
  dbPath = join(tmpdir(), `crypto-exec-restore-${randomUUID().slice(0, 8)}.db`);
  memory = new Memory(dbPath);
});

afterEach(() => {
  memory.close();
  if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
});

function makeExec(overrides: { fetchPositions?: any } = {}) {
  const exchange = {
    fetchTicker: vi.fn().mockResolvedValue({ last: 50000 }),
    fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 10000, total: 10000 } }),
    fetchPositions: overrides.fetchPositions ?? vi.fn().mockResolvedValue({}),
    createOrder: vi.fn(),
    fetchOpenOrders: vi.fn().mockResolvedValue([]),
  } as any;
  const marketData = {
    exchangeId: "okx",
    fetchTicker: vi.fn().mockResolvedValue({ symbol: "BTC/USDT", last: 50000, timestamp: Date.now() }),
    fetchOhlcv: vi.fn(),
    fetchOrderBook: vi.fn(),
  };
  const feed = new EventEmitter() as any;
  feed.subscribeTicker = vi.fn();
  feed.unsubscribe = vi.fn();
  const store = new StrategyStore();
  const riskGate = {
    evaluate: vi.fn(),
    recordPnl: vi.fn(),
  } as any;
  const executor = new OrderExecutor({ marketData, exchange, feed, riskGate, store, memory, paperMode: false });
  return { executor, exchange, feed, store };
}

describe("OrderExecutor.restore()", () => {
  test("restores matching positions from DB + exchange", async () => {
    memory.saveActivePosition({
      ruleId: "r1",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 50000,
      amount: 0.01,
      stopLoss: 48500,
      takeProfit: 52500,
      enteredAt: 1700000000000,
      source: "fast_path",
    });

    const { executor } = makeExec({
      fetchPositions: vi.fn().mockResolvedValue({
        "BTC/USDT:long": { amount: 0.01, avg_entry_price: 50000, current_price: 51000 },
      }),
    });

    const summary = await executor.restore();
    expect(summary.restored).toEqual(["r1"]);
    expect(summary.staleDropped).toHaveLength(0);
    expect(summary.orphans).toHaveLength(0);
    expect(executor.activePositions).toHaveLength(1);
    expect(executor.activePositions[0].ruleId).toBe("r1");
    expect(executor.activePositions[0].stopLoss).toBe(48500);
  });

  test("drops stale records when exchange no longer has the position", async () => {
    memory.saveActivePosition({
      ruleId: "r-stale",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 50000,
      amount: 0.01,
      stopLoss: 48500,
      takeProfit: 52500,
      enteredAt: 1700000000000,
      source: "fast_path",
    });

    const { executor } = makeExec({
      fetchPositions: vi.fn().mockResolvedValue({}),
    });

    const summary = await executor.restore();
    expect(summary.restored).toHaveLength(0);
    expect(summary.staleDropped).toEqual(["r-stale"]);
    expect(executor.activePositions).toHaveLength(0);
    // DB should have been cleaned up too
    expect(memory.loadActivePositions()).toHaveLength(0);
  });

  test("reports orphan positions on exchange that we don't track", async () => {
    // No local record
    const { executor } = makeExec({
      fetchPositions: vi.fn().mockResolvedValue({
        "ETH/USDT:long": { amount: 1, avg_entry_price: 3000, current_price: 3100 },
      }),
    });

    const summary = await executor.restore();
    expect(summary.restored).toHaveLength(0);
    expect(summary.staleDropped).toHaveLength(0);
    expect(summary.orphans).toHaveLength(1);
    expect(summary.orphans[0].key).toBe("ETH/USDT:long");
    // Orphans are just reported, NOT auto-added to the executor (the user decides)
    expect(executor.activePositions).toHaveLength(0);
  });

  test("keeps local records when exchange is unreachable (conservative fallback)", async () => {
    memory.saveActivePosition({
      ruleId: "r1",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 50000,
      amount: 0.01,
      stopLoss: 48500,
      takeProfit: 52500,
      enteredAt: 1700000000000,
      source: "fast_path",
    });

    const { executor } = makeExec({
      fetchPositions: vi.fn().mockRejectedValue(new Error("network timeout")),
    });

    const summary = await executor.restore();
    // Position is restored in memory (we trust the local record until we can verify)
    expect(executor.activePositions).toHaveLength(1);
    expect(summary.restored).toEqual(["r1"]);
    // DB record is NOT deleted
    expect(memory.loadActivePositions()).toHaveLength(1);
  });
});
