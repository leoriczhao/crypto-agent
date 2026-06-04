import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PaperExchange } from "../src/exchange/paper.js";
import { Memory } from "../src/memory.js";
import { StrategyManager } from "../src/strategy/manager.js";
import { StrategyRuntime } from "../src/strategy/runtime.js";
import { GridStrategy } from "../src/strategy/grid-strategy.js";
import { OrderExecutor } from "../src/strategy/executor.js";
import { RiskGate } from "../src/strategy/risk-gate.js";

/**
 * Full-pipeline integration: GridStrategy → Runtime → OrderExecutor → PaperExchange.
 * Simulates ticks by calling paper.processTick directly and verifies the
 * buy → fill → sell → fill → rebuy cycle.
 */

let dbPath: string;
let memory: Memory;

beforeEach(() => {
  dbPath = join(tmpdir(), `crypto-grid-e2e-${randomUUID().slice(0, 8)}.db`);
  memory = new Memory(dbPath);
  // Executor.logTrade persists with session_id='system' — FK requires that row.
  memory.createSession("system", "system", "system");
});

afterEach(async () => {
  memory.close();
  if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
});

function setup(initialLast: number) {
  const paper = new PaperExchange("okx", { USDT: 5000 });
  // Stub the underlying live fetchTicker so fetchTicker always returns our controlled price
  (paper as any).live.fetchTicker = vi.fn().mockResolvedValue({
    symbol: "BTC/USDT", last: initialLast, bid: initialLast, ask: initialLast, volume: 0, timestamp: Date.now(),
  });

  const feed = new EventEmitter() as any;
  feed.subscribeTicker = (_sym: string, cb: any) => { feed.on("tick", cb); };
  feed.subscribeOhlcv = () => {};
  feed.subscribeOrderBook = () => {};
  feed.unsubscribe = () => {};

  const manager = new StrategyManager(memory);
  const riskGate = new RiskGate(manager, paper as any, 5000, memory);

  const executor = new OrderExecutor({
    exchange: paper as any,
    feed,
    riskGate,
    store: manager,
    memory,
    paperMode: true,
  });

  const runtime = new StrategyRuntime({ feed, manager, memory, exchange: paper as any });

  runtime.on("signal", (signal) => {
    executor.handleSignal(signal).catch(() => {});
  });
  runtime.wireExecutor(executor);

  // PaperExchange fills → executor.onExchangeFill.
  // Track the promise so tests can await pending fill processing.
  const pendingFills: Promise<any>[] = [];
  paper.on("orderFilled", (o: any) => {
    pendingFills.push(executor.onExchangeFill(o.id, o.price).catch(() => {}));
  });
  (setup as any).lastPendingFills = pendingFills;

  return { paper, feed, manager, runtime, executor, pendingFills };
}

async function flush(pendingFills: Promise<any>[]) {
  // Drain all async limit-fill processing before returning.
  while (pendingFills.length) {
    const batch = pendingFills.splice(0);
    await Promise.all(batch);
  }
  await new Promise((r) => setTimeout(r, 5));
}

async function emitTick(
  feed: EventEmitter,
  paper: PaperExchange,
  pendingFills: Promise<any>[],
  symbol: string,
  last: number,
) {
  // Order matters: let the strategy react to the price first (placeBuy emits signal
  // → executor creates limit → paper stores it), THEN let paper match against the
  // same price for any pre-existing resting orders.
  feed.emit("tick", { symbol, last, bid: last, ask: last, volume: 0, timestamp: Date.now() });
  await flush(pendingFills);
  (paper as any).live.fetchTicker = vi.fn().mockResolvedValue({
    symbol, last, bid: last, ask: last, volume: 0, timestamp: Date.now(),
  });
  paper.processTick(symbol, last);
  await flush(pendingFills);
}

describe("GridStrategy — full pipeline", () => {
  test("places buys → fills → places sells → fills → rearms buys", async () => {
    const { paper, feed, manager, runtime, executor, pendingFills } = setup(100);

    const grid = manager.addStrategy({
      kind: "grid",
      symbol: "BTC/USDT",
      allocatedUsdt: 500,
      params: { side: "long", lowerPrice: 90, upperPrice: 110, gridCount: 5, sizePerGrid: 50 },
    }) as GridStrategy;
    runtime.startOne(grid);

    // Levels: 90, 95, 100, 105, 110 (spacing 5)

    // Tick 1: price at 100 → buys placed at 90 and 95 (levels below)
    await emitTick(feed, paper, pendingFills, "BTC/USDT", 100);
    let open = await paper.fetchOpenOrders();
    expect(open.filter((o) => o.side === "buy")).toHaveLength(2);
    expect(open.map((o) => o.price).sort((a, b) => a - b)).toEqual([90, 95]);

    // Tick 2: drop to 95 → the 95 buy fills; strategy should place sell at 100
    await emitTick(feed, paper, pendingFills, "BTC/USDT", 95);
    open = await paper.fetchOpenOrders();
    const buys95After = open.filter((o) => o.side === "buy" && o.price === 95);
    const sells100 = open.filter((o) => o.side === "sell" && o.price === 100);
    expect(buys95After).toHaveLength(0); // 95 buy is consumed (filled)
    expect(sells100).toHaveLength(1);    // replacement sell at 100

    // Balance should reflect the 95 buy fill
    const bal = await paper.fetchBalance();
    expect(bal.USDT.total).toBeCloseTo(5000 - 50, 1); // spent 50 USDT

    // Tick 3: price pumps to 100 → sell at 100 fills; strategy rearms buy at 95
    await emitTick(feed, paper, pendingFills, "BTC/USDT", 100);
    open = await paper.fetchOpenOrders();
    const rearmedBuy95 = open.filter((o) => o.side === "buy" && o.price === 95);
    expect(rearmedBuy95).toHaveLength(1); // buy re-placed

    // Realized gain: bought 0.5263... BTC @95, sold same @100 — small profit.
    // Grid net USDT should be back near 5000 (minus the still-open 90 buy lock).
    const bal2 = await paper.fetchBalance();
    // Spent 50 on 90 buy (still outstanding) + roundtrip profit from 95→100.
    // Free USDT = 5000 - 50 (locked in 90 order) + (50/95)*100 - 50 = ~4952.6...
    // Actually the 90 buy hasn't filled, so no USDT locked yet (paper doesn't reserve).
    // Sell at 100 gave back 0.52631×100 = 52.63. Original 50 → +2.63 realized.
    expect(bal2.USDT.total).toBeCloseTo(5000 + (50 / 95) * 100 - 50, 1);
  });

  test("stopOne cascades cancel on all open orders", async () => {
    const { paper, feed, manager, runtime, pendingFills } = setup(100);
    const grid = manager.addStrategy({
      kind: "grid",
      symbol: "BTC/USDT",
      allocatedUsdt: 500,
      params: { side: "long", lowerPrice: 90, upperPrice: 110, gridCount: 5, sizePerGrid: 50 },
    });
    runtime.startOne(grid);
    await emitTick(feed, paper, pendingFills, "BTC/USDT", 100);

    expect((await paper.fetchOpenOrders()).length).toBe(2);

    await runtime.stopOne(grid.id);

    const open = await paper.fetchOpenOrders();
    expect(open).toHaveLength(0);

    // pending_orders rows should be marked cancelled
    const pending = memory.getOpenPendingOrdersByStrategy(grid.id);
    expect(pending).toHaveLength(0);
  });

  test("grid with insufficient allocation can't over-spend budget", async () => {
    // 5 levels × $50 = $250 max exposure. Allocate only $120 → first 2 buys fit, 3rd+ rejected.
    const { paper, feed, manager, runtime, executor, pendingFills } = setup(100);
    const rejections: any[] = [];
    executor.on("rejected", (r) => rejections.push(r));

    const grid = manager.addStrategy({
      kind: "grid",
      symbol: "BTC/USDT",
      allocatedUsdt: 120,
      params: { side: "long", lowerPrice: 80, upperPrice: 100, gridCount: 5, sizePerGrid: 50 },
    });
    runtime.startOne(grid);

    // Tick at 100 → levels 80/85/90/95 below → tries 4 buys, but allocation caps at 2 × $50 = $100
    await emitTick(feed, paper, pendingFills, "BTC/USDT", 100);
    const open = await paper.fetchOpenOrders();
    // With $120 alloc and $50 per buy: first buy locks 50 (used=50), second locks 50 (used=100),
    // third would push used to 150 > 120 → rejected.
    expect(open.length).toBeLessThanOrEqual(2);
    expect(rejections.length).toBeGreaterThan(0);
    expect(rejections[0].reason).toContain("Strategy budget");
  });
});
