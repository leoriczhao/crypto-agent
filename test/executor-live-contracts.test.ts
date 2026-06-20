import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import { OrderExecutor } from "../src/strategy/executor.js";
import { StrategyStore, type Signal } from "../src/strategy/state.js";

function makeExecutor() {
  const exchange = {
    createOrder: vi.fn().mockResolvedValue({
      id: "live-swap-entry-1",
      status: "filled",
      price: 50000,
    }),
    fetchPositions: vi.fn().mockResolvedValue({}),
    fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 2000, total: 2000 } }),
    fetchOpenOrders: vi.fn().mockResolvedValue([]),
  };
  const marketData = {
    exchangeId: "okx",
    fetchTicker: vi.fn().mockResolvedValue({ symbol: "BTC/USDT:USDT", last: 50000, timestamp: Date.now() }),
    fetchOhlcv: vi.fn(),
    fetchOrderBook: vi.fn(),
  };
  const feed = new EventEmitter() as any;
  feed.subscribeTicker = vi.fn();
  const riskGate = {
    evaluate: vi.fn().mockResolvedValue({ approved: true }),
    recordPnl: vi.fn(),
  };
  const executor = new OrderExecutor({
    marketData,
    exchange: exchange as any,
    feed,
    riskGate: riskGate as any,
    store: new StrategyStore() as any,
    paperMode: false,
    contractPositionMode: "hedge",
    contractMarginMode: "isolated",
  });
  return { executor, exchange, riskGate };
}

describe("OrderExecutor live contracts", () => {
  test("submits swap entries with live contract params", async () => {
    const { executor, exchange } = makeExecutor();
    const signal: Signal = {
      ruleId: "strategy-1",
      symbol: "BTC/USDT:USDT",
      side: "short",
      action: "enter",
      sizeUsdt: 100,
      leverage: 2,
      reason: "test swap entry",
      timestamp: Date.now(),
    };

    await executor.handleSignal(signal);

    expect(exchange.createOrder).toHaveBeenCalledWith(
      "BTC/USDT:USDT",
      "sell",
      "market",
      0.002,
      undefined,
      expect.objectContaining({
        marketType: "swap",
        positionMode: "hedge",
        positionSide: "short",
        marginMode: "isolated",
        leverage: 2,
        reduceOnly: false,
      }),
    );
  });
});
