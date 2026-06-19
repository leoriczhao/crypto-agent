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
    ["BTC/USDT:USDT", 50000],
    ["ETH/USDT:USDT", 3000],
  ]);
  fetchTicker = vi.fn(async (symbol: string) => {
    const last = this.prices.get(symbol) ?? 1;
    return { symbol, last, bid: last - 1, ask: last + 1, volume: 100, timestamp: Date.now() };
  });
  fetchOhlcv = vi.fn(async () => []);
  fetchOrderBook = vi.fn(async () => ({ bids: [], asks: [] }));
}

describe("PaperBroker USDT linear contracts", () => {
  let dbPath: string;
  let memory: Memory;
  let marketData: StubMarketData;
  let broker: PaperBroker;
  let identity: ReturnType<Memory["ensureDefaultIdentity"]>;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-paper-contracts-${randomUUID().slice(0, 8)}.db`);
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

  test("opens a long with isolated margin and marks unrealized PnL", async () => {
    const order = await broker.createOrder({
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "long",
      orderType: "market",
      amount: 0.004,
      notionalUsdt: 200,
      leverage: 5,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    expect(order).toMatchObject({ status: "filled", price: 50000 });

    let balance = await broker.fetchBalance(identity.bot.id);
    expect(balance.USDT.free).toBeCloseTo(1960);
    expect(balance.USDT.used).toBeCloseTo(40);

    marketData.prices.set("BTC/USDT:USDT", 55000);
    await broker.markToMarket("BTC/USDT:USDT", 55000);
    const positions = await broker.fetchPositions(identity.bot.id);
    expect(positions["BTC/USDT:USDT:long"]).toMatchObject({
      symbol: "BTC/USDT:USDT",
      side: "long",
      amount: 0.004,
      avg_entry_price: 50000,
      current_price: 55000,
      leverage: 5,
    });
    expect(positions["BTC/USDT:USDT:long"].unrealized_pnl).toBeCloseTo(20);
    balance = await broker.fetchBalance(identity.bot.id);
    expect(balance.USDT.total).toBeCloseTo(2020);
  });

  test("closes a long, releases margin, and realizes PnL", async () => {
    await broker.createOrder({
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "long",
      orderType: "market",
      amount: 0.004,
      notionalUsdt: 200,
      leverage: 5,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    marketData.prices.set("BTC/USDT:USDT", 55000);

    const close = await broker.createOrder({
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "sell",
      positionSide: "long",
      orderType: "market",
      amount: 0.004,
      reduceOnly: true,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });

    expect(close.status).toBe("filled");
    const balance = await broker.fetchBalance(identity.bot.id);
    expect(balance.USDT.free).toBeCloseTo(2020);
    expect(balance.USDT.used).toBeCloseTo(0);
    expect(await broker.fetchPositions(identity.bot.id)).toEqual({});
    expect(memory.getBotAllocation(identity.bot.id, identity.tradingAccount.id, "USDT")!.realizedPnl).toBeCloseTo(20);
  });

  test("opens a short and rejects reducing more than the current position", async () => {
    const open = await broker.createOrder({
      symbol: "ETH/USDT:USDT",
      marketType: "swap",
      side: "sell",
      positionSide: "short",
      orderType: "market",
      amount: 0.0333333333,
      notionalUsdt: 100,
      leverage: 3,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    expect(open.status).toBe("filled");
    expect((await broker.fetchBalance(identity.bot.id)).USDT.used).toBeCloseTo(100 / 3);

    marketData.prices.set("ETH/USDT:USDT", 2800);
    await broker.markToMarket("ETH/USDT:USDT", 2800);
    const pos = (await broker.fetchPositions(identity.bot.id))["ETH/USDT:USDT:short"];
    expect(pos.unrealized_pnl).toBeCloseTo((3000 - 2800) * 0.0333333333);

    const badClose = await broker.createOrder({
      symbol: "ETH/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "short",
      orderType: "market",
      amount: 0.05,
      reduceOnly: true,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    expect(badClose.error).toContain("exceeds position amount");
  });

  test("persists contract positions across broker restart", async () => {
    await broker.createOrder({
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "long",
      orderType: "market",
      amount: 0.004,
      notionalUsdt: 200,
      leverage: 5,
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    marketData.prices.set("BTC/USDT:USDT", 52500);

    const reopenedMemory = new Memory(dbPath);
    const reopenedBroker = new PaperBroker({
      memory: reopenedMemory,
      marketData,
      tradingAccountId: identity.tradingAccount.id,
    });
    await reopenedBroker.markToMarket("BTC/USDT:USDT", 52500);
    const positions = await reopenedBroker.fetchPositions(identity.bot.id);
    expect(positions["BTC/USDT:USDT:long"].unrealized_pnl).toBeCloseTo(10);
    reopenedMemory.close();
  });
});
