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

function makeMockBroker(overrides: Record<string, any> = {}) {
  return {
    fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 10000, used: 0, total: 10000 } }),
    fetchPositions: vi.fn().mockResolvedValue({}),
    createOrder: vi.fn().mockResolvedValue({ id: "paper-1", status: "filled", side: "buy", amount: 0.001, price: 50000 }),
    ...overrides,
  };
}

describe("tools (mocked exchange)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test.skip("get_price returns ticker data (needs network)", async () => {
    // Public market data hits real ccxt — skip or mock
  });

  test("buy handler: normal order", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange();
    const broker = makeMockBroker();
    const result = await TOOL_HANDLERS.buy({ exchange, market_data: exchange, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.001 });
    expect(result).toContain("PAPER");
    expect(result.toLowerCase()).toContain("filled");
  });

  test("buy handler uses paper broker with session attribution when available", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange();
    const broker = {
      fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 10000, used: 0, total: 10000 } }),
      fetchPositions: vi.fn().mockResolvedValue({}),
      createOrder: vi.fn().mockResolvedValue({
        id: "paper-spot-1",
        symbol: "BTC/USDT",
        status: "filled",
        side: "buy",
        amount: 0.001,
        price: 50000,
      }),
    };
    const memory = {
      getSessionBinding: vi.fn().mockReturnValue({ botId: "bot-1", tradingAccountId: "acct-1" }),
      getPortfolioWatermark: vi.fn().mockReturnValue(null),
      getDailyPnl: vi.fn().mockReturnValue(null),
    };

    const result = await TOOL_HANDLERS.buy({
      exchange,
      market_data: exchange,
      broker,
      config,
      memory,
      sessionId: "session-1",
      soul: defaultSoul,
      strategy_store: null,
      symbol: "BTC/USDT",
      amount: 0.001,
    });

    expect(result).toContain("PAPER");
    expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "BTC/USDT",
      marketType: "spot",
      actorType: "session",
      actorId: "session-1",
      botId: "bot-1",
      tradingAccountId: "acct-1",
    }));
    expect(exchange.createOrder).not.toHaveBeenCalled();
  });

  test("buy handler: order too large", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange();
    const broker = makeMockBroker();
    // 0.2 BTC * 50000 = $10000 > maxOrderSizeUsdt ($5000)
    const result = await TOOL_HANDLERS.buy({ exchange, market_data: exchange, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.2 });
    expect(result).toContain("BLOCKED");
    expect(result).toContain("exceeds max");
  });

  test("buy handler: blocked by soul position limit", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const exchange = makeMockExchange();
    const broker = makeMockBroker();
    const conservativeSoul = { max_position_pct: 10, stop_loss_pct: 3 };
    // 0.04 BTC * 50000 = $2000, portfolio = $10000, position = 20% > 10% (soul cap)
    const result = await TOOL_HANDLERS.buy({ exchange, market_data: exchange, broker, config, memory: null, sessionId: null, soul: conservativeSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.04 });
    expect(result).toContain("BLOCKED");
    expect(result).toContain("soul ceiling");
  });

  test("buy handler: riskParams from strategy_store tightens limits", async () => {
    await import("../src/tools/buy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const { config } = await import("../src/config.js");
    const { DEFAULT_RISK_PARAMS } = await import("../src/strategy/state.js");
    const exchange = makeMockExchange();
    const broker = makeMockBroker();
    // Simulate user tightened riskParams via manage_rules to 5%
    const mockStore = { riskParams: { ...DEFAULT_RISK_PARAMS, maxPositionPct: 5 } };
    // 0.02 BTC * 50000 = $1000, 10% of $10000 > 5% riskParams
    const result = await TOOL_HANDLERS.buy({ exchange, market_data: exchange, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: mockStore, symbol: "BTC/USDT", amount: 0.02 });
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
    const broker = makeMockBroker({
      createOrder: vi.fn().mockResolvedValue({ id: "paper-2", status: "filled", side: "sell", amount: 0.001, price: 50000 }),
    });
    const result = await TOOL_HANDLERS.sell({ exchange, market_data: exchange, broker, config, memory: null, sessionId: null, soul: defaultSoul, strategy_store: null, symbol: "BTC/USDT", amount: 0.001 });
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

  test("get_portfolio shows active bot allocation when memory is available", async () => {
    await import("../src/tools/get-portfolio.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const exchange = makeMockExchange();
    const broker = {
      fetchBalance: vi.fn().mockResolvedValue({ USDT: { free: 1500, used: 500, total: 2000 } }),
      fetchPositions: vi.fn().mockResolvedValue({}),
      fetchOpenOrders: vi.fn().mockResolvedValue([]),
    };
    const memory = {
      getSessionBinding: vi.fn().mockReturnValue({ botId: "bot-1", tradingAccountId: "acct-1" }),
      getBotAllocation: vi.fn().mockReturnValue({
        allocated: 2000,
        free: 1500,
        used: 500,
        realizedPnl: 12.5,
      }),
    };

    const result = await TOOL_HANDLERS.get_portfolio({
      exchange,
      broker,
      memory,
      sessionId: "session-1",
    });

    expect(result).toContain("Active Bot");
    expect(result).toContain("bot-1");
    expect(result).toContain("2,000.00");
    expect(result).toContain("1,500.00");
  });

  test("get_portfolio no positions", async () => {
    await import("../src/tools/get-portfolio.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const exchange = makeMockExchange();
    const result = await TOOL_HANDLERS.get_portfolio({ exchange });
    expect(result).toContain("No open positions");
  });

  test("open_position opens a paper USDT contract from notional sizing", async () => {
    await import("../src/tools/open-position.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const exchange = makeMockExchange({
      fetchTicker: vi.fn().mockResolvedValue({ symbol: "BTC/USDT:USDT", last: 50000 }),
    });
    const broker = {
      createOrder: vi.fn().mockResolvedValue({
        id: "paper-1",
        symbol: "BTC/USDT:USDT",
        status: "filled",
        price: 50000,
        amount: 0.004,
      }),
    };

    const result = await TOOL_HANDLERS.open_position({
      exchange,
      market_data: exchange,
      broker,
      config: { paperTrading: true, paperMaxLeverage: 5 },
      memory: null,
      sessionId: "s1",
      symbol: "BTC/USDT:USDT",
      side: "long",
      notional_usdt: 200,
      leverage: 5,
      order_type: "market",
    });

    expect(result).toContain("PAPER");
    expect(result).toContain("filled");
    expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "long",
      amount: 0.004,
      notionalUsdt: 200,
      leverage: 5,
      actorType: "session",
      actorId: "s1",
    }));
  });

  test("open_position attributes orders to llm_trader jobs when session matches a trader job", async () => {
    await import("../src/tools/open-position.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const exchange = makeMockExchange({
      fetchTicker: vi.fn().mockResolvedValue({ symbol: "ETH/USDT:USDT", last: 2500 }),
    });
    const broker = {
      createOrder: vi.fn().mockResolvedValue({
        id: "paper-llm-1",
        symbol: "ETH/USDT:USDT",
        status: "filled",
        price: 2500,
        amount: 0.04,
      }),
    };
    const memory = {
      getLlmTraderJobBySessionId: vi.fn().mockReturnValue({
        id: 7,
        botId: "bot-llm",
        tradingAccountId: "acct-llm",
        sessionId: "llm-trader-1",
      }),
      logTrade: vi.fn(),
    };

    await TOOL_HANDLERS.open_position({
      exchange,
      market_data: exchange,
      broker,
      config: { paperTrading: true, paperMaxLeverage: 5 },
      memory,
      sessionId: "llm-trader-1",
      symbol: "ETH/USDT:USDT",
      side: "short",
      notional_usdt: 100,
      leverage: 2,
    });

    expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      actorType: "llm_trader",
      actorId: "7",
      botId: "bot-llm",
      tradingAccountId: "acct-llm",
    }));
  });

  test("open_position rejects leverage above paper max", async () => {
    await import("../src/tools/open-position.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const result = await TOOL_HANDLERS.open_position({
      exchange: makeMockExchange(),
      market_data: makeMockExchange(),
      broker: { createOrder: vi.fn() },
      config: { paperTrading: true, paperMaxLeverage: 5 },
      symbol: "BTC/USDT:USDT",
      side: "long",
      notional_usdt: 200,
      leverage: 10,
      order_type: "market",
    });
    expect(result).toContain("BLOCKED");
    expect(result).toContain("leverage");
  });

  test("close_position closes the full paper contract position when amount is omitted", async () => {
    await import("../src/tools/close-position.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const broker = {
      fetchPositions: vi.fn().mockResolvedValue({
        "BTC/USDT:USDT:long": {
          symbol: "BTC/USDT:USDT",
          side: "long",
          amount: 0.004,
          avg_entry_price: 50000,
          current_price: 55000,
        },
      }),
      createOrder: vi.fn().mockResolvedValue({
        id: "paper-2",
        symbol: "BTC/USDT:USDT",
        status: "filled",
        price: 55000,
        amount: 0.004,
      }),
    };

    const result = await TOOL_HANDLERS.close_position({
      broker,
      config: { paperTrading: true },
      sessionId: "s1",
      symbol: "BTC/USDT:USDT",
      side: "long",
      order_type: "market",
    });

    expect(result).toContain("PAPER");
    expect(result).toContain("filled");
    expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "sell",
      positionSide: "long",
      amount: 0.004,
      reduceOnly: true,
    }));
  });

  test("open_position reports live contract mode as unsupported", async () => {
    await import("../src/tools/open-position.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const result = await TOOL_HANDLERS.open_position({
      exchange: makeMockExchange(),
      market_data: makeMockExchange(),
      broker: null,
      config: { paperTrading: false, paperMaxLeverage: 5 },
      symbol: "BTC/USDT:USDT",
      side: "long",
      notional_usdt: 200,
      leverage: 2,
    });
    expect(result).toContain("unsupported");
    expect(result).toContain("paper");
  });

  test("plan_grid_strategy rejects allocation above active bot free USDT", async () => {
    await import("../src/tools/plan-grid-strategy.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const strategyStore = { addStrategy: vi.fn() };
    const memory = {
      getDefaultBot: vi.fn().mockReturnValue({ id: "bot-1", tradingAccountId: "acct-1" }),
      getBotAllocation: vi.fn().mockReturnValue({ free: 120, used: 0, total: 120 }),
    };

    const result = await TOOL_HANDLERS.plan_grid_strategy({
      strategy_store: strategyStore,
      memory,
      symbol: "BTC/USDT",
      lower_price: 45000,
      upper_price: 55000,
      grid_count: 5,
      size_per_grid: 50,
      allocated_usdt: 500,
    });

    expect(result).toContain("Error");
    expect(result).toContain("bot free USDT");
    expect(strategyStore.addStrategy).not.toHaveBeenCalled();
  });
});
