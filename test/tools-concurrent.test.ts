import { describe, test, expect, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    paperTrading: true,
    maxOrderSizeUsdt: 10000,
    initialBalance: { USDT: 10000 },
  },
}));

const defaultSoul = { max_position_pct: 100, stop_loss_pct: 10 };

/**
 * Concurrency tests that prove the global trade lock actually serializes
 * overlapping buy/sell calls that target the same account.
 */
describe("buy/sell concurrent serialization", () => {
  test("two concurrent buys run in strict serial order", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");

    const events: string[] = [];
    const marketData = {
      fetchTicker: vi.fn().mockResolvedValue({ last: 50000 }),
    };
    const broker = {
      fetchBalance: vi.fn().mockImplementation(async () => {
        events.push("balance");
        return { USDT: { free: 10000, total: 10000 } };
      }),
      fetchPositions: vi.fn().mockResolvedValue({}),
      createOrder: vi.fn().mockImplementation(async (order: any) => {
        events.push(`order:${order.symbol}:${order.side}:${order.amount}`);
        // Simulate latency so interleaving is obvious if the lock is broken
        await new Promise((r) => setTimeout(r, 15));
        return { id: `mock-${events.length}`, status: "filled", price: 50000, amount: order.amount };
      }),
    };

    await Promise.all([
      TOOL_HANDLERS.buy({ exchange: null, market_data: marketData, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.001 }),
      TOOL_HANDLERS.buy({ exchange: null, market_data: marketData, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "ETH/USDT", amount: 0.01 }),
    ]);

    // Expected strict order: balance→order (first), then balance→order (second).
    // Broken order (interleaved) would look like: balance, balance, order, order.
    const firstBalance = events.indexOf("balance");
    const firstOrder = events.findIndex((e) => e.startsWith("order"));
    const secondBalance = events.indexOf("balance", firstBalance + 1);
    const secondOrder = events.findIndex((e, i) => i > firstOrder && e.startsWith("order"));

    expect(firstBalance).toBeLessThan(firstOrder);
    expect(firstOrder).toBeLessThan(secondBalance);
    expect(secondBalance).toBeLessThan(secondOrder);
  });

  test("buy and sell concurrent on same symbol also serialize", async () => {
    await import("../src/tools/buy.js");
    await import("../src/tools/sell.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");

    let activeOperations = 0;
    let maxConcurrent = 0;

    const marketData = {
      fetchTicker: vi.fn().mockResolvedValue({ last: 50000 }),
    };
    const broker = {
      fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 10000, total: 10000 } }),
      fetchPositions: vi.fn().mockResolvedValue({
        "BTC/USDT:long": { amount: 0.001, current_price: 50000, avg_entry_price: 50000 },
      }),
      createOrder: vi.fn().mockImplementation(async () => {
        activeOperations++;
        maxConcurrent = Math.max(maxConcurrent, activeOperations);
        await new Promise((r) => setTimeout(r, 10));
        activeOperations--;
        return { id: "mock", status: "filled", price: 50000, amount: 0.001 };
      }),
    };

    await Promise.all([
      TOOL_HANDLERS.buy({ exchange: null, market_data: marketData, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.001 }),
      TOOL_HANDLERS.sell({ exchange: null, market_data: marketData, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.001 }),
      TOOL_HANDLERS.buy({ exchange: null, market_data: marketData, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.001 }),
    ]);

    // With the lock, at most one createOrder should run at any instant
    expect(maxConcurrent).toBe(1);
  });
});
