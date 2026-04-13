import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    paperTrading: true,
    maxOrderSizeUsdt: 1000,
  },
}));

function makeMockExchange(overrides: Record<string, any> = {}) {
  return {
    fetchTicker: vi.fn().mockResolvedValue({ last: 50000, bid: 49999, ask: 50001, symbol: "BTC/USDT" }),
    fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 10000, used: 0, total: 10000 } }),
    fetchPositions: vi.fn().mockResolvedValue({}),
    fetchOpenOrders: vi.fn().mockResolvedValue([]),
    createOrder: vi.fn().mockResolvedValue({ id: "mock-1", status: "filled", side: "buy", amount: 0.001, price: 50000 }),
    _orders: [],
    ...overrides,
  };
}

describe("tools (mocked exchange)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test.skip("get_price returns ticker data (needs network)", async () => {
    // PaperExchange hits real ccxt — skip or mock
  });

  test("buy handler: normal order", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange();
    const result = await TOOL_HANDLERS.buy({ exchange, config, memory: null, sessionId: null, symbol: "BTC/USDT", amount: 0.001 });
    expect(result).toContain("PAPER");
    expect(result.toLowerCase()).toContain("filled");
  });

  test("buy handler: order too large", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange();
    const result = await TOOL_HANDLERS.buy({ exchange, config, memory: null, sessionId: null, symbol: "BTC/USDT", amount: 100 });
    expect(result).toContain("exceeds max");
  });

  test("get_portfolio shows balance", async () => {
    await import("../src/tools/get-portfolio.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const exchange = makeMockExchange();
    const result = await TOOL_HANDLERS.get_portfolio({ exchange });
    expect(result).toContain("USDT");
  });

  test("get_portfolio no positions", async () => {
    await import("../src/tools/get-portfolio.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const exchange = makeMockExchange();
    const result = await TOOL_HANDLERS.get_portfolio({ exchange });
    expect(result).toContain("No open positions");
  });
});
