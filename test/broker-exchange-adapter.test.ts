import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";
import { PaperBroker } from "../src/broker/paper-broker.js";
import { BrokerExchangeAdapter } from "../src/broker/exchange-adapter.js";
import type { MarketDataProvider } from "../src/market-data/types.js";

class StubMarketData implements MarketDataProvider {
  readonly exchangeId = "okx";
  prices = new Map<string, number>([
    ["BTC/USDT", 50000],
    ["ETH/USDT", 3000],
  ]);
  ccxtInstance = { id: "okx" };
  fetchTicker = vi.fn(async (symbol: string) => {
    const last = this.prices.get(symbol) ?? 1;
    return { symbol, last, bid: last - 1, ask: last + 1, volume: 100, timestamp: Date.now() };
  });
  fetchOhlcv = vi.fn(async (_symbol: string, _timeframe = "1h", limit = 2) =>
    Array.from({ length: limit }, (_, i) => ({
      timestamp: 1700000000000 + i * 60_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
    })),
  );
  fetchOrderBook = vi.fn(async () => ({ bids: [[49999, 1] as [number, number]], asks: [[50001, 1] as [number, number]] }));
  close = vi.fn(async () => {});
}

describe("BrokerExchangeAdapter", () => {
  let dbPath: string;
  let memory: Memory;
  let marketData: StubMarketData;
  let adapter: BrokerExchangeAdapter;
  let identity: ReturnType<Memory["ensureDefaultIdentity"]>;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-adapter-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
    identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 2000,
    });
    marketData = new StubMarketData();
    const broker = new PaperBroker({ memory, marketData, tradingAccountId: identity.tradingAccount.id });
    adapter = new BrokerExchangeAdapter({
      marketData,
      broker,
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("delegates market data calls to the provider", async () => {
    await expect(adapter.fetchTicker("BTC/USDT")).resolves.toMatchObject({ symbol: "BTC/USDT", last: 50000 });
    await expect(adapter.fetchOhlcv("BTC/USDT", "1h", 3)).resolves.toHaveLength(3);
    await expect(adapter.fetchOrderBook("BTC/USDT", 5)).resolves.toMatchObject({ bids: [[49999, 1]], asks: [[50001, 1]] });
    expect(marketData.fetchTicker).toHaveBeenCalledWith("BTC/USDT");
    expect(marketData.fetchOhlcv).toHaveBeenCalledWith("BTC/USDT", "1h", 3);
    expect(marketData.fetchOrderBook).toHaveBeenCalledWith("BTC/USDT", 5);
  });

  test("maps current BaseExchange spot order calls to broker orders", async () => {
    const order = await adapter.createOrder("BTC/USDT", "buy", "market", 0.01);
    expect(order).toMatchObject({ symbol: "BTC/USDT", side: "buy", type: "market", status: "filled", price: 50000 });

    const balance = await adapter.fetchBalance();
    expect(balance.USDT.free).toBeCloseTo(1500);
    expect(balance.BTC.total).toBeCloseTo(0.01);

    const positions = await adapter.fetchPositions();
    expect(positions["BTC/USDT"].amount).toBeCloseTo(0.01);
    expect(positions["BTC/USDT:long"].amount).toBeCloseTo(0.01);
  });

  test("keeps open limit orders cancellable through the old interface", async () => {
    const order = await adapter.createOrder("BTC/USDT", "buy", "limit", 0.01, 49000);
    expect(order.status).toBe("open");
    await expect(adapter.fetchOpenOrders("BTC/USDT")).resolves.toHaveLength(1);

    const cancel = await adapter.cancelOrder(order.id, "BTC/USDT");
    expect(cancel).toMatchObject({ id: order.id, status: "cancelled" });
    await expect(adapter.fetchOpenOrders("BTC/USDT")).resolves.toHaveLength(0);
  });
});
