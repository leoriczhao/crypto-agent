import { describe, expect, test, vi } from "vitest";

const ccxtMock = vi.hoisted(() => ({
  instances: [] as MockOkx[],
}));

type RecordedOrder = {
  symbol: string;
  type: string;
  side: string;
  amount: number;
  price: number | undefined;
  params: Record<string, unknown>;
};

type RecordedLeverage = {
  leverage: number;
  symbol: string;
  params: Record<string, unknown>;
};

class MockOkx {
  readonly opts: Record<string, unknown>;
  readonly orders: RecordedOrder[] = [];
  readonly leverages: RecordedLeverage[] = [];
  positions: Array<Record<string, unknown>> = [];

  constructor(opts: Record<string, unknown>) {
    this.opts = opts;
    ccxtMock.instances.push(this);
  }

  async createOrder(
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price: number | undefined,
    params: Record<string, unknown> = {},
  ) {
    this.orders.push({ symbol, type, side, amount, price, params });
    return { id: "okx-order-1", symbol, type, side, amount, price, status: "open" };
  }

  async setLeverage(leverage: number, symbol: string, params: Record<string, unknown> = {}) {
    this.leverages.push({ leverage, symbol, params });
    return { leverage, symbol, params };
  }

  async loadMarkets() {}

  market(symbol: string) {
    return {
      id: symbol.replace("/", "-").replace(":", "-"),
      symbol,
      contract: symbol.includes(":"),
      contractSize: symbol.startsWith("BTC/") ? 0.01 : 0.1,
    };
  }

  async fetchTicker(symbol: string) {
    return { symbol, last: 50000 };
  }

  async fetchOHLCV() {
    return [];
  }

  async fetchOrderBook() {
    return { bids: [], asks: [] };
  }

  async cancelOrder(orderId: string) {
    return { id: orderId, status: "canceled" };
  }

  async fetchBalance() {
    return {};
  }

  async fetchOpenOrders() {
    return [];
  }

  async fetchPositions() {
    return this.positions;
  }

  async close() {}
}

vi.mock("ccxt", () => ({
  default: { okx: MockOkx },
}));

describe("LiveExchange contract orders", () => {
  test("sets leverage before opening an isolated hedge-mode swap position", async () => {
    const { LiveExchange } = await import("../src/exchange/live.js");
    const exchange = new LiveExchange("okx", "api-key", "secret", "passphrase", "http://proxy");

    const result = await exchange.createOrder("BTC/USDT:USDT", "buy", "market", 0.004, undefined, {
      marketType: "swap",
      marginMode: "isolated",
      positionSide: "long",
      leverage: 3,
    });

    const instance = ccxtMock.instances.at(-1)!;
    expect(instance.opts).toMatchObject({
      apiKey: "api-key",
      secret: "secret",
      password: "passphrase",
      httpsProxy: "http://proxy",
    });
    expect(instance.leverages).toEqual([
      {
        leverage: 3,
        symbol: "BTC/USDT:USDT",
        params: { marginMode: "isolated", posSide: "long" },
      },
    ]);
    expect(instance.orders).toEqual([
      {
        symbol: "BTC/USDT:USDT",
        type: "market",
        side: "buy",
        amount: 0.4,
        price: undefined,
        params: {
          marginMode: "isolated",
          positionSide: "long",
        },
      },
    ]);
    expect(result).toMatchObject({
      id: "okx-order-1",
      symbol: "BTC/USDT:USDT",
      side: "buy",
      amount: 0.4,
      status: "open",
    });
  });

  test("passes reduceOnly without changing leverage for live contract closes", async () => {
    const { LiveExchange } = await import("../src/exchange/live.js");
    const exchange = new LiveExchange("okx");

    await exchange.createOrder("ETH/USDT:USDT", "buy", "limit", 0.2, 2400, {
      marketType: "swap",
      marginMode: "isolated",
      positionSide: "short",
      reduceOnly: true,
    });

    const instance = ccxtMock.instances.at(-1)!;
    expect(instance.leverages).toEqual([]);
    expect(instance.orders[0]).toEqual({
      symbol: "ETH/USDT:USDT",
      type: "limit",
      side: "buy",
      amount: 2,
      price: 2400,
      params: {
        marginMode: "isolated",
        positionSide: "short",
        reduceOnly: true,
      },
    });
  });

  test("normalizes live contract positions to base amount while keeping contracts", async () => {
    const { LiveExchange } = await import("../src/exchange/live.js");
    const exchange = new LiveExchange("okx");
    const instance = ccxtMock.instances.at(-1)!;
    instance.positions = [
      {
        symbol: "BTC/USDT:USDT",
        side: "long",
        contracts: 2,
        contractSize: 0.01,
        entryPrice: 50000,
        markPrice: 51000,
        notional: 1000,
        unrealizedPnl: 20,
        leverage: 5,
        marginMode: "isolated",
        hedged: true,
      },
    ];

    const positions = await exchange.fetchPositions();

    expect(positions["BTC/USDT:USDT:long"]).toMatchObject({
      symbol: "BTC/USDT:USDT",
      side: "long",
      amount: 0.02,
      contracts: 2,
      avg_entry_price: 50000,
      current_price: 51000,
      unrealized_pnl: 20,
      leverage: 5,
      margin_mode: "isolated",
    });
  });
});
