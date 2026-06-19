import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";
import { PaperBroker } from "../src/broker/paper-broker.js";
import type { MarketDataProvider } from "../src/market-data/types.js";

class StubMarketData implements MarketDataProvider {
  readonly exchangeId = "okx";
  prices = new Map<string, number>([
    ["BTC/USDT", 50000],
    ["ETH/USDT", 3000],
  ]);
  fetchTicker = vi.fn(async (symbol: string) => {
    const last = this.prices.get(symbol) ?? 1;
    return { symbol, last, bid: last - 1, ask: last + 1, volume: 100, timestamp: Date.now() };
  });
  fetchOhlcv = vi.fn(async () => []);
  fetchOrderBook = vi.fn(async () => ({ bids: [], asks: [] }));
}

describe("PaperBroker spot accounting", () => {
  let dbPath: string;
  let memory: Memory;
  let marketData: StubMarketData;
  let broker: PaperBroker;
  let identity: ReturnType<Memory["ensureDefaultIdentity"]>;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-paper-broker-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
    identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 2000,
    });
    marketData = new StubMarketData();
    broker = new PaperBroker({ memory, marketData, tradingAccountId: identity.tradingAccount.id });
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("market buy debits USDT and creates a compatible spot position", async () => {
    const order = await broker.createOrder({
      symbol: "BTC/USDT",
      marketType: "spot",
      side: "buy",
      orderType: "market",
      amount: 0.01,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });

    expect(order).toMatchObject({ status: "filled", side: "buy", price: 50000 });
    const balance = await broker.fetchBalance(identity.bot.id);
    expect(balance.USDT.free).toBeCloseTo(1500);
    expect(balance.BTC.total).toBeCloseTo(0.01);
    const positions = await broker.fetchPositions(identity.bot.id);
    expect(positions["BTC/USDT"].avg_entry_price).toBeCloseTo(50000);
    expect(positions["BTC/USDT:long"].amount).toBeCloseTo(0.01);
  });

  test("limit buy persists open, fills on mark price cross, and records actor-attributed fill", async () => {
    const order = await broker.createOrder({
      symbol: "BTC/USDT",
      marketType: "spot",
      side: "buy",
      orderType: "limit",
      amount: 0.01,
      price: 49000,
      actorType: "strategy",
      actorId: "strategy-1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    expect(order.status).toBe("open");

    const reopenedMemory = new Memory(dbPath);
    const reopenedBroker = new PaperBroker({
      memory: reopenedMemory,
      marketData,
      tradingAccountId: identity.tradingAccount.id,
    });
    expect(await reopenedBroker.fetchOpenOrders("BTC/USDT", identity.bot.id)).toHaveLength(1);

    await reopenedBroker.markToMarket("BTC/USDT", 49000);
    expect(await reopenedBroker.fetchOpenOrders("BTC/USDT", identity.bot.id)).toHaveLength(0);
    const fills = reopenedMemory.listPaperFills({ orderId: order.id });
    expect(fills[0]).toMatchObject({
      orderId: order.id,
      actorType: "strategy",
      actorId: "strategy-1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      price: 49000,
    });
    reopenedMemory.close();
  });

  test("sell requires base balance and credits USDT on fill", async () => {
    await broker.createOrder({
      symbol: "BTC/USDT",
      marketType: "spot",
      side: "buy",
      orderType: "market",
      amount: 0.01,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    marketData.prices.set("BTC/USDT", 51000);

    const sell = await broker.createOrder({
      symbol: "BTC/USDT",
      marketType: "spot",
      side: "sell",
      orderType: "market",
      amount: 0.004,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });

    expect(sell.status).toBe("filled");
    const balance = await broker.fetchBalance(identity.bot.id);
    expect(balance.BTC.total).toBeCloseTo(0.006);
    expect(balance.USDT.free).toBeCloseTo(1500 + 0.004 * 51000);
  });

  test("insufficient funds rejects market orders and cancels limit orders at fill time", async () => {
    const market = await broker.createOrder({
      symbol: "BTC/USDT",
      marketType: "spot",
      side: "buy",
      orderType: "market",
      amount: 1,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    expect(market.error).toContain("Insufficient USDT");

    const limit = await broker.createOrder({
      symbol: "BTC/USDT",
      marketType: "spot",
      side: "buy",
      orderType: "limit",
      amount: 1,
      price: 49000,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    expect(limit.status).toBe("open");
    await broker.markToMarket("BTC/USDT", 49000);
    const orders = memory.listPaperOrders({ tradingAccountId: identity.tradingAccount.id, botId: identity.bot.id });
    expect(orders.find((o) => o.id === limit.id)?.status).toBe("cancelled");
  });
});
