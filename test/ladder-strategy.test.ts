import { describe, test, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { LadderStrategy } from "../src/strategy/ladder-strategy.js";
import type { StrategyContext } from "../src/strategy/base.js";
import type { Signal, RiskParams } from "../src/strategy/state.js";

function makeCtx(): { ctx: StrategyContext; signals: Signal[]; feed: EventEmitter } {
  const signals: Signal[] = [];
  const feed = new EventEmitter() as any;
  feed.subscribeTicker = () => {};
  feed.subscribeOhlcv = () => {};
  feed.subscribeOrderBook = () => {};
  const ctx: StrategyContext = {
    feed,
    emitSignal: (s) => signals.push(s),
    getRiskParams: () => ({} as RiskParams),
  };
  return { ctx, signals, feed };
}

function tick(symbol: string, last: number): any {
  return { symbol, last, bid: last, ask: last, volume: 0, timestamp: Date.now() };
}

describe("LadderStrategy — long side", () => {
  let strat: LadderStrategy;
  let signals: Signal[];

  beforeEach(() => {
    strat = new LadderStrategy({
      id: "s-ladder-1",
      symbol: "BTC/USDT",
      allocatedUsdt: 1000,
      params: {
        side: "long",
        levels: [
          { triggerPrice: 70000, sizeUsdt: 200 },
          { triggerPrice: 68000, sizeUsdt: 300 },
          { triggerPrice: 66000, sizeUsdt: 500 },
        ],
        takeProfitPct: 3,
        stopLossPct: 10,
      },
    });
    const { ctx, signals: sigs } = makeCtx();
    signals = sigs;
    strat.start(ctx);
  });

  test("fires L0 when price drops below first trigger", () => {
    strat.onTick(tick("BTC/USDT", 70100));
    expect(signals).toHaveLength(0);

    strat.onTick(tick("BTC/USDT", 69999));
    expect(signals).toHaveLength(1);
    expect(signals[0].positionId).toBe("s-ladder-1:L0");
    expect(signals[0].action).toBe("enter");
    expect(signals[0].sizeUsdt).toBe(200);
  });

  test("doesn't re-fire the same level twice", () => {
    strat.onTick(tick("BTC/USDT", 69000));
    const firstCount = signals.length;
    strat.onTick(tick("BTC/USDT", 69500));
    strat.onTick(tick("BTC/USDT", 69200));
    expect(signals.length).toBe(firstCount);
  });

  test("cascading drop fires multiple levels in one tick batch", () => {
    strat.onTick(tick("BTC/USDT", 65000)); // drops past all 3 triggers
    expect(signals.filter((s) => s.action === "enter")).toHaveLength(3);
    expect(signals.map((s) => s.positionId).sort()).toEqual([
      "s-ladder-1:L0",
      "s-ladder-1:L1",
      "s-ladder-1:L2",
    ]);
  });

  test("onOrderFilled(enter) records leg; combinedAvgEntry is weighted", () => {
    strat.onOrderFilled({
      action: "enter",
      positionId: "s-ladder-1:L0",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 70000,
      amount: 200 / 70000,
      timestamp: Date.now(),
    });
    strat.onOrderFilled({
      action: "enter",
      positionId: "s-ladder-1:L1",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 68000,
      amount: 300 / 68000,
      timestamp: Date.now(),
    });

    const avg = strat.combinedAvgEntry()!;
    // weighted avg: (70000 * 200/70000 + 68000 * 300/68000) / (200/70000 + 300/68000)
    // = (200 + 300) / (200/70000 + 300/68000)
    // = 500 / 0.0028571 + 0.0044117 ≈ 500 / 0.00727 ≈ 68766
    expect(avg).toBeGreaterThan(68000);
    expect(avg).toBeLessThan(70000);
    expect(strat.openLegCount).toBe(2);
  });

  test("combined take-profit triggers exit for each open leg", () => {
    // Fill two legs manually
    strat.onOrderFilled({ action: "enter", positionId: "s-ladder-1:L0", symbol: "BTC/USDT", side: "long", entryPrice: 70000, amount: 200 / 70000, timestamp: 1 });
    strat.onOrderFilled({ action: "enter", positionId: "s-ladder-1:L1", symbol: "BTC/USDT", side: "long", entryPrice: 68000, amount: 300 / 68000, timestamp: 2 });

    const avg = strat.combinedAvgEntry()!;
    const tpPrice = avg * 1.03 + 1; // just above TP

    strat.onTick(tick("BTC/USDT", tpPrice));
    const exits = signals.filter((s) => s.action === "exit");
    expect(exits).toHaveLength(2);
    expect(exits.map((s) => s.positionId).sort()).toEqual([
      "s-ladder-1:L0",
      "s-ladder-1:L1",
    ]);
  });

  test("exit doesn't re-fire while legs remain open", () => {
    strat.onOrderFilled({ action: "enter", positionId: "s-ladder-1:L0", symbol: "BTC/USDT", side: "long", entryPrice: 70000, amount: 200 / 70000, timestamp: 1 });

    const tpPrice = 70000 * 1.05;
    strat.onTick(tick("BTC/USDT", tpPrice));
    const firstCount = signals.filter((s) => s.action === "exit").length;

    strat.onTick(tick("BTC/USDT", tpPrice + 100));
    const secondCount = signals.filter((s) => s.action === "exit").length;
    expect(secondCount).toBe(firstCount);
  });

  test("after all legs exit, next level drop can fire a fresh cycle", () => {
    // Fire L0 + L1, exit them, then verify L2 can still fire
    strat.onTick(tick("BTC/USDT", 68500));
    strat.onOrderFilled({ action: "enter", positionId: "s-ladder-1:L0", symbol: "BTC/USDT", side: "long", entryPrice: 70000, amount: 200 / 70000, timestamp: 1 });
    strat.onOrderFilled({ action: "enter", positionId: "s-ladder-1:L1", symbol: "BTC/USDT", side: "long", entryPrice: 68500, amount: 300 / 68500, timestamp: 2 });
    // TP trigger and simulated exits
    strat.onTick(tick("BTC/USDT", 75000));
    strat.onOrderFilled({ action: "exit", positionId: "s-ladder-1:L0", symbol: "BTC/USDT", side: "long", pnl: 100, timestamp: 3 });
    strat.onOrderFilled({ action: "exit", positionId: "s-ladder-1:L1", symbol: "BTC/USDT", side: "long", pnl: 150, timestamp: 4 });

    // L2 is still untouched (trigger 66000); price must drop there
    const sigsBefore = signals.length;
    strat.onTick(tick("BTC/USDT", 65900));
    const l2Signals = signals.slice(sigsBefore).filter((s) => s.action === "enter" && s.positionId === "s-ladder-1:L2");
    expect(l2Signals).toHaveLength(1);
  });

  test("stopLoss triggers exit when combined loss exceeds threshold", () => {
    strat.onOrderFilled({ action: "enter", positionId: "s-ladder-1:L0", symbol: "BTC/USDT", side: "long", entryPrice: 70000, amount: 200 / 70000, timestamp: 1 });

    const slPrice = 70000 * 0.89; // -11% below entry, past the 10% SL
    strat.onTick(tick("BTC/USDT", slPrice));
    const exits = signals.filter((s) => s.action === "exit");
    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toContain("stop-loss");
  });
});

describe("LadderStrategy — short side symmetry", () => {
  test("short ladder fires levels as price rises", () => {
    const strat = new LadderStrategy({
      id: "s-short",
      symbol: "ETH/USDT",
      allocatedUsdt: 1000,
      params: {
        side: "short",
        levels: [
          { triggerPrice: 3000, sizeUsdt: 200 },
          { triggerPrice: 3200, sizeUsdt: 300 },
        ],
        takeProfitPct: 3,
      },
    });
    const { ctx, signals } = makeCtx();
    strat.start(ctx);

    strat.onTick(tick("ETH/USDT", 3100));
    expect(signals.filter((s) => s.action === "enter")).toHaveLength(1);

    strat.onTick(tick("ETH/USDT", 3250));
    expect(signals.filter((s) => s.action === "enter")).toHaveLength(2);
    expect(signals[1].side).toBe("short");
  });
});
