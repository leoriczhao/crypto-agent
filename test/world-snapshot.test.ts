import { describe, test, expect, vi } from "vitest";
import { buildWorldSnapshot } from "../src/world-snapshot.js";

function makeMockExchange(overrides: Record<string, any> = {}) {
  return {
    fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 8000, used: 0, total: 10000 } }),
    fetchPositions: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as any;
}

describe("buildWorldSnapshot", () => {
  test("includes mode and balance", async () => {
    const result = await buildWorldSnapshot({ paperTrading: true, exchange: makeMockExchange() });
    expect(result).toContain("PAPER");
    expect(result).toContain("$10,000.00");
    expect(result).toContain("$8,000.00");
  });

  test("includes active bot allocation and open order count", async () => {
    const memory = {
      getSessionBinding: vi.fn().mockReturnValue({ botId: "bot-1", tradingAccountId: "acct-1" }),
      getBotAllocation: vi.fn().mockReturnValue({
        allocated: 2000,
        free: 1500,
        used: 500,
        realizedPnl: 12.5,
      }),
    };
    const broker = {
      fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 1500, used: 500, total: 2000 } }),
      fetchPositions: vi.fn().mockResolvedValue({}),
      fetchOpenOrders: vi.fn().mockResolvedValue([
        { id: "o1", symbol: "BTC/USDT", side: "buy", amount: 0.01 },
      ]),
    };

    const result = await buildWorldSnapshot({
      paperTrading: true,
      memory: memory as any,
      broker: broker as any,
      sessionId: "session-1",
    });

    expect(result).toContain("Bot: bot-1");
    expect(result).toContain("allocation $2,000.00");
    expect(result).toContain("free $1,500.00");
    expect(result).toContain("Open orders: 1");
  });

  test("shows LIVE mode", async () => {
    const result = await buildWorldSnapshot({ paperTrading: false, exchange: makeMockExchange() });
    expect(result).toContain("LIVE");
  });

  test("shows no positions when empty", async () => {
    const result = await buildWorldSnapshot({ paperTrading: false, exchange: makeMockExchange() });
    expect(result).toContain("Positions: none");
  });

  test("shows positions with PnL", async () => {
    const exchange = makeMockExchange({
      fetchPositions: vi.fn().mockResolvedValue({
        "BTC/USDT:long": { amount: 0.1, avg_entry_price: 50000, current_price: 55000 },
      }),
    });
    const result = await buildWorldSnapshot({ paperTrading: false, exchange });
    expect(result).toContain("BTC/USDT:long");
    expect(result).toContain("+10.0%");
    expect(result).toContain("Positions (1)");
  });

  test("includes active strategies count", async () => {
    const store = {
      getActiveStrategies: vi.fn().mockReturnValue([
        { symbol: "BTC/USDT" },
        { symbol: "ETH/USDT" },
      ]),
    } as any;
    const result = await buildWorldSnapshot({
      paperTrading: true,
      strategyStore: store,
      exchange: makeMockExchange(),
    });
    expect(result).toContain("Active strategies: 2");
    expect(result).toContain("BTC/USDT");
  });

  test("handles exchange errors gracefully", async () => {
    const exchange = makeMockExchange({
      fetchBalance: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const result = await buildWorldSnapshot({ paperTrading: true, exchange });
    expect(result).toContain("Snapshot error");
    expect(result).toContain("timeout");
  });

  test("omits rules section when no strategy store", async () => {
    const result = await buildWorldSnapshot({ paperTrading: true, exchange: makeMockExchange() });
    expect(result).not.toContain("Active rules");
  });
});
