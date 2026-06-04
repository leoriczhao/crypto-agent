import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    paperTrading: true,
    maxOrderSizeUsdt: 5000,
    initialBalance: { USDT: 10000 },
  },
}));

const defaultSoul = { max_position_pct: 20, stop_loss_pct: 5 };

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
    const result = await TOOL_HANDLERS.buy({ exchange, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.001 });
    expect(result).toContain("PAPER");
    expect(result.toLowerCase()).toContain("filled");
  });

  test("buy handler: order too large", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange();
    // 0.2 BTC * 50000 = $10000 > maxOrderSizeUsdt ($5000)
    const result = await TOOL_HANDLERS.buy({ exchange, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.2 });
    expect(result).toContain("BLOCKED");
    expect(result).toContain("exceeds max");
  });

  test("buy handler: blocked by soul position limit", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange();
    const conservativeSoul = { max_position_pct: 10, stop_loss_pct: 3 };
    // 0.04 BTC * 50000 = $2000, portfolio = $10000, position = 20% > 10% (soul cap)
    const result = await TOOL_HANDLERS.buy({ exchange, config, memory: null, sessionId: null, soul: conservativeSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.04 });
    expect(result).toContain("BLOCKED");
    expect(result).toContain("soul ceiling");
  });

  test("buy handler: riskParams from strategy_store tightens limits", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const { DEFAULT_RISK_PARAMS } = await import("../src/strategy/state.js");
    const exchange = makeMockExchange();
    // Simulate user tightened riskParams via manage_rules to 5%
    const mockStore = { riskParams: { ...DEFAULT_RISK_PARAMS, maxPositionPct: 5 } };
    // 0.02 BTC * 50000 = $1000, 10% of $10000 > 5% riskParams
    const result = await TOOL_HANDLERS.buy({ exchange, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: mockStore, symbol: "BTC/USDT", amount: 0.02 });
    expect(result).toContain("BLOCKED");
    expect(result).toContain("risk params");
  });

  test("sell handler: normal order", async () => {
    await import("../src/tools/sell.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange({
      createOrder: vi.fn().mockResolvedValue({ id: "mock-2", status: "filled", side: "sell", amount: 0.001, price: 50000 }),
    });
    const result = await TOOL_HANDLERS.sell({ exchange, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.001 });
    expect(result).toContain("PAPER");
    expect(result.toLowerCase()).toContain("filled");
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
