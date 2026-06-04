import { describe, test, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { GridStrategy } from "../src/strategy/grid-strategy.js";
import type { StrategyContext } from "../src/strategy/base.js";
import type { Signal, RiskParams } from "../src/strategy/state.js";

function makeCtx(): { ctx: StrategyContext; signals: Signal[]; cancelled: string[] } {
  const signals: Signal[] = [];
  const cancelled: string[] = [];
  const feed = new EventEmitter() as any;
  feed.subscribeTicker = () => {};
  feed.subscribeOhlcv = () => {};
  feed.subscribeOrderBook = () => {};
  const ctx: StrategyContext = {
    feed,
    emitSignal: (s) => signals.push(s),
    cancelOrder: async (id) => { cancelled.push(id); },
    getRiskParams: () => ({} as RiskParams),
  };
  return { ctx, signals, cancelled };
}

function tick(symbol: string, last: number): any {
  return { symbol, last, bid: last, ask: last, volume: 0, timestamp: Date.now() };
}

describe("GridStrategy — long", () => {
  let grid: GridStrategy;
  let signals: Signal[];

  beforeEach(() => {
    grid = new GridStrategy({
      id: "g-1",
      symbol: "BTC/USDT",
      allocatedUsdt: 500,
      params: {
        side: "long",
        lowerPrice: 70000,
        upperPrice: 75000,
        gridCount: 6, // levels: 70000, 71000, 72000, 73000, 74000, 75000 (spacing 1000)
        sizePerGrid: 80,
      },
    });
    const { ctx, signals: sigs } = makeCtx();
    signals = sigs;
    grid.start(ctx);
  });

  test("first tick places buys at every level below market", () => {
    grid.onTick(tick("BTC/USDT", 74500));
    // Levels 70k, 71k, 72k, 73k, 74k are all below 74500 → 5 buys.
    // Level 75k is above → skipped.
    const buys = signals.filter((s) => s.action === "enter" && s.orderType === "limit");
    expect(buys).toHaveLength(5);
    expect(buys.map((s) => s.limitPrice).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      70000, 71000, 72000, 73000, 74000,
    ]);
  });

  test("buys only placed once (idempotent on repeat tick)", () => {
    grid.onTick(tick("BTC/USDT", 74500));
    const firstCount = signals.length;
    grid.onTick(tick("BTC/USDT", 74400));
    grid.onTick(tick("BTC/USDT", 74600));
    expect(signals.length).toBe(firstCount);
  });

  test("buy fill triggers a sell one spacing above", () => {
    grid.onTick(tick("BTC/USDT", 74500));
    // Simulate L1 (71000) buy fills
    grid.onOrderFilled({
      action: "enter",
      positionId: "g-1:G1",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 71000,
      amount: 80 / 71000,
      timestamp: Date.now(),
    });
    const sells = signals.filter((s) => s.action === "exit" && s.orderType === "limit");
    expect(sells).toHaveLength(1);
    expect(sells[0].limitPrice).toBe(72000); // 71000 + 1000 spacing
    expect(sells[0].positionId).toBe("g-1:G1");
  });

  test("sell fill replaces buy at original level", () => {
    grid.onTick(tick("BTC/USDT", 74500));
    grid.onOrderFilled({ action: "enter", positionId: "g-1:G1", symbol: "BTC/USDT", side: "long", entryPrice: 71000, amount: 80 / 71000, timestamp: 1 });
    // Now sell fills at 72000 — gain captured, should rearm buy at 71000
    grid.onOrderFilled({ action: "exit", positionId: "g-1:G1", symbol: "BTC/USDT", side: "long", pnl: 80 * (1000 / 71000), timestamp: 2 });
    const newBuys = signals.filter((s) => s.action === "enter" && s.limitPrice === 71000);
    expect(newBuys).toHaveLength(2); // initial + re-armed
  });

  test("level above market price at start stays idle", () => {
    // Market at 72500 — levels 73k, 74k, 75k all above → stay idle on first tick
    grid.onTick(tick("BTC/USDT", 72500));
    const states = grid.levelStates;
    expect(states.find((s) => s.idx === 3)?.state).toBe("idle"); // 73k
    expect(states.find((s) => s.idx === 4)?.state).toBe("idle"); // 74k
    expect(states.find((s) => s.idx === 5)?.state).toBe("idle"); // 75k
  });

  test("grid with < 2 levels rejected in build", () => {
    const bad = new GridStrategy({
      id: "bad",
      symbol: "BTC/USDT",
      params: {
        side: "long",
        lowerPrice: 70000,
        upperPrice: 75000,
        gridCount: 1,
        sizePerGrid: 50,
      },
    });
    const { ctx } = makeCtx();
    expect(() => bad.start(ctx)).toThrow(/gridCount/);
  });

  test("required subscriptions = ticker only", () => {
    const subs = grid.requiredSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].type).toBe("ticker");
  });

  test("stop() drops internal state", () => {
    grid.onTick(tick("BTC/USDT", 74500));
    expect(grid.levelStates).toHaveLength(6);
    grid.stop();
    expect(grid.levelStates).toHaveLength(0);
  });

  test("buy pending avoids double-placement if tick fires again", () => {
    grid.onTick(tick("BTC/USDT", 74500));
    const buysAtL1 = signals.filter((s) => s.limitPrice === 71000 && s.action === "enter").length;
    grid.onTick(tick("BTC/USDT", 74300));
    const buysAtL1After = signals.filter((s) => s.limitPrice === 71000 && s.action === "enter").length;
    expect(buysAtL1After).toBe(buysAtL1);
  });
});
