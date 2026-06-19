import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { Memory, type PersistedActivePosition } from "../src/memory.js";

/**
 * Unit tests for the new persistence tables added in Iteration 11.
 * Each test uses a fresh temp DB file so they don't cross-contaminate.
 */

let dbPath: string;
let memory: Memory;

beforeEach(() => {
  dbPath = join(tmpdir(), `crypto-persist-${randomUUID().slice(0, 8)}.db`);
  memory = new Memory(dbPath);
});

afterEach(() => {
  memory.close();
  if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
});

describe("A0 — active_positions", () => {
  test("save + load round-trip", () => {
    const pos: PersistedActivePosition = {
      ruleId: "rule-1",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 50000,
      amount: 0.01,
      stopLoss: 48500,
      takeProfit: 52500,
      enteredAt: 1700000000000,
      source: "fast_path",
    };
    memory.saveActivePosition(pos);
    const loaded = memory.loadActivePositions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject(pos);
  });

  test("save is upsert (same ruleId overwrites)", () => {
    const base: PersistedActivePosition = {
      ruleId: "r", symbol: "BTC/USDT", side: "long", entryPrice: 50000,
      amount: 0.01, stopLoss: 48000, takeProfit: 52000, enteredAt: 1, source: "fast_path",
    };
    memory.saveActivePosition(base);
    memory.saveActivePosition({ ...base, stopLoss: 49000 });
    const loaded = memory.loadActivePositions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].stopLoss).toBe(49000);
  });

  test("delete removes the row", () => {
    memory.saveActivePosition({
      ruleId: "r", symbol: "BTC/USDT", side: "long", entryPrice: 50000,
      amount: 0.01, stopLoss: 48000, takeProfit: 52000, enteredAt: 1, source: "fast_path",
    });
    memory.deleteActivePosition("r");
    expect(memory.loadActivePositions()).toHaveLength(0);
  });

  test("load returns entries ordered by enteredAt ascending", () => {
    memory.saveActivePosition({
      ruleId: "b", symbol: "BTC/USDT", side: "long", entryPrice: 1,
      amount: 1, stopLoss: 1, takeProfit: 1, enteredAt: 200, source: "fast_path",
    });
    memory.saveActivePosition({
      ruleId: "a", symbol: "ETH/USDT", side: "long", entryPrice: 1,
      amount: 1, stopLoss: 1, takeProfit: 1, enteredAt: 100, source: "fast_path",
    });
    const loaded = memory.loadActivePositions();
    expect(loaded.map((p) => p.ruleId)).toEqual(["a", "b"]);
  });

  test("stores bot and trading account identity", () => {
    const identity = memory.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });
    memory.saveActivePosition({
      ruleId: "r",
      strategyId: "strategy-1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 50000,
      amount: 0.01,
      stopLoss: 48000,
      takeProfit: 52000,
      enteredAt: 1,
      source: "fast_path",
    });

    const loaded = memory.loadActivePositions();
    expect(loaded[0].botId).toBe(identity.bot.id);
    expect(loaded[0].tradingAccountId).toBe(identity.tradingAccount.id);
  });

  test("uses default identity when caller omits bot and trading account", () => {
    const identity = memory.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });
    memory.saveActivePosition({
      ruleId: "r",
      strategyId: "strategy-1",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 50000,
      amount: 0.01,
      stopLoss: 48000,
      takeProfit: 52000,
      enteredAt: 1,
      source: "fast_path",
    });

    const loaded = memory.loadActivePositions();
    expect(loaded[0].botId).toBe(identity.bot.id);
    expect(loaded[0].tradingAccountId).toBe(identity.tradingAccount.id);
  });
});

describe("A1 — daily_pnl", () => {
  test("getDailyPnl returns 0 for an unseen date", () => {
    expect(memory.getDailyPnl("2099-01-01")).toBe(0);
  });

  test("addDailyPnl accumulates on the same date", () => {
    memory.addDailyPnl("2026-04-16", -10);
    memory.addDailyPnl("2026-04-16", -5);
    memory.addDailyPnl("2026-04-16", +3);
    expect(memory.getDailyPnl("2026-04-16")).toBeCloseTo(-12);
  });

  test("different dates are independent", () => {
    memory.addDailyPnl("2026-04-15", -100);
    memory.addDailyPnl("2026-04-16", +50);
    expect(memory.getDailyPnl("2026-04-15")).toBe(-100);
    expect(memory.getDailyPnl("2026-04-16")).toBe(50);
  });

  test("survives a Memory close/reopen (true persistence)", () => {
    memory.addDailyPnl("2026-04-16", -42);
    memory.close();
    const reopened = new Memory(dbPath);
    expect(reopened.getDailyPnl("2026-04-16")).toBe(-42);
    reopened.close();
  });
});

describe("A2 — pending_orders", () => {
  test("create + update lifecycle", () => {
    const id = memory.createPendingOrder({
      sessionId: "s1",
      symbol: "BTC/USDT",
      side: "buy",
      orderType: "limit",
      price: 49000,
      amount: 0.01,
    });
    expect(id).toBeGreaterThan(0);

    memory.updatePendingOrder(id, { exchangeOrderId: "ex-123", status: "open" });
    let open = memory.loadOpenPendingOrders();
    expect(open).toHaveLength(1);
    expect(open[0].exchangeOrderId).toBe("ex-123");
    expect(open[0].status).toBe("open");

    memory.updatePendingOrder(id, { status: "filled" });
    open = memory.loadOpenPendingOrders();
    expect(open).toHaveLength(0);
  });

  test("only returns 'open' status", () => {
    const id1 = memory.createPendingOrder({
      symbol: "BTC/USDT", side: "buy", orderType: "market", amount: 1,
    });
    const id2 = memory.createPendingOrder({
      symbol: "ETH/USDT", side: "sell", orderType: "market", amount: 1,
    });
    memory.updatePendingOrder(id1, { status: "filled" });
    // id2 stays open by default
    const open = memory.loadOpenPendingOrders();
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(id2);
  });

  test("stores bot and trading account identity", () => {
    const identity = memory.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });
    memory.createPendingOrder({
      sessionId: "s1",
      strategyId: "strategy-1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      symbol: "BTC/USDT",
      side: "buy",
      orderType: "limit",
      price: 49000,
      amount: 0.01,
    });

    const open = memory.loadOpenPendingOrders();
    expect(open[0].botId).toBe(identity.bot.id);
    expect(open[0].tradingAccountId).toBe(identity.tradingAccount.id);
  });

  test("uses default identity when caller omits bot and trading account", () => {
    const identity = memory.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });
    memory.createPendingOrder({
      sessionId: "s1",
      strategyId: "strategy-1",
      symbol: "BTC/USDT",
      side: "buy",
      orderType: "limit",
      price: 49000,
      amount: 0.01,
    });

    const open = memory.loadOpenPendingOrders();
    expect(open[0].botId).toBe(identity.bot.id);
    expect(open[0].tradingAccountId).toBe(identity.tradingAccount.id);
  });
});

describe("B1 — strategy identity", () => {
  test("uses default identity when saving strategy snapshots", () => {
    const identity = memory.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });
    memory.saveStrategy({
      id: "strategy-1",
      kind: "signal",
      symbol: "BTC/USDT",
      params: { timeframe: "1h" },
      allocatedUsdt: 100,
      enabled: true,
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
    });

    const loaded = memory.loadAllStrategies();
    expect(loaded[0].botId).toBe(identity.bot.id);
    expect(loaded[0].tradingAccountId).toBe(identity.tradingAccount.id);
  });

  test("identity seed backfills legacy strategy, position, and pending order rows", () => {
    memory.saveStrategy({
      id: "strategy-1",
      kind: "signal",
      symbol: "BTC/USDT",
      params: { timeframe: "1h" },
      allocatedUsdt: 100,
      enabled: true,
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
    });
    memory.saveActivePosition({
      ruleId: "r",
      strategyId: "strategy-1",
      symbol: "BTC/USDT",
      side: "long",
      entryPrice: 50000,
      amount: 0.01,
      stopLoss: 48000,
      takeProfit: 52000,
      enteredAt: 1,
      source: "fast_path",
    });
    memory.createPendingOrder({
      sessionId: "s1",
      strategyId: "strategy-1",
      symbol: "BTC/USDT",
      side: "buy",
      orderType: "limit",
      price: 49000,
      amount: 0.01,
    });

    const identity = memory.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });

    expect(memory.loadAllStrategies()[0].botId).toBe(identity.bot.id);
    expect(memory.loadAllStrategies()[0].tradingAccountId).toBe(identity.tradingAccount.id);
    expect(memory.loadActivePositions()[0].botId).toBe(identity.bot.id);
    expect(memory.loadActivePositions()[0].tradingAccountId).toBe(identity.tradingAccount.id);
    expect(memory.loadOpenPendingOrders()[0].botId).toBe(identity.bot.id);
    expect(memory.loadOpenPendingOrders()[0].tradingAccountId).toBe(identity.tradingAccount.id);
  });
});

describe("A3 — portfolio_watermark", () => {
  test("returns null before any update", () => {
    expect(memory.getPortfolioWatermark()).toBeNull();
  });

  test("first update sets the peak", () => {
    const wm = memory.updatePortfolioWatermark(10000);
    expect(wm.peakValue).toBe(10000);
    expect(memory.getPortfolioWatermark()!.peakValue).toBe(10000);
  });

  test("higher value lifts the peak", () => {
    memory.updatePortfolioWatermark(10000);
    const wm = memory.updatePortfolioWatermark(12000);
    expect(wm.peakValue).toBe(12000);
  });

  test("lower value does NOT lower the peak (critical for drawdown)", () => {
    memory.updatePortfolioWatermark(12000);
    const wm = memory.updatePortfolioWatermark(8000);
    expect(wm.peakValue).toBe(12000);
    expect(memory.getPortfolioWatermark()!.peakValue).toBe(12000);
  });
});

describe("B0 — daemon_state KV", () => {
  test("returns null for unset key", () => {
    expect(memory.getDaemonState("nonexistent")).toBeNull();
  });

  test("set + get round-trip", () => {
    memory.setDaemonState("active_soul", "aggressive");
    expect(memory.getDaemonState("active_soul")).toBe("aggressive");
  });

  test("set is upsert (same key overwrites)", () => {
    memory.setDaemonState("active_soul", "conservative");
    memory.setDaemonState("active_soul", "aggressive");
    expect(memory.getDaemonState("active_soul")).toBe("aggressive");
  });

  test("delete removes the key", () => {
    memory.setDaemonState("x", "1");
    memory.deleteDaemonState("x");
    expect(memory.getDaemonState("x")).toBeNull();
  });

  test("survives close/reopen", () => {
    memory.setDaemonState("active_soul", "aggressive");
    memory.setDaemonState("active_exchange", "okx");
    memory.close();
    const reopened = new Memory(dbPath);
    expect(reopened.getDaemonState("active_soul")).toBe("aggressive");
    expect(reopened.getDaemonState("active_exchange")).toBe("okx");
    reopened.close();
  });
});

describe("Paper broker persistence", () => {
  test("seeds bot allocation once and does not reset on reopen", () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const first = memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 2000,
    });
    expect(first.free).toBe(2000);

    memory.updateBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      freeDelta: -100,
      usedDelta: 100,
    });
    memory.close();

    const reopened = new Memory(dbPath);
    const second = reopened.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 2000,
    });
    expect(second.free).toBe(1900);
    expect(second.used).toBe(100);
    reopened.close();
  });

  test("persists paper orders, positions, and fills with actor attribution", () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const order = memory.createPaperOrder({
      id: "paper-1",
      tradingAccountId: identity.tradingAccount.id,
      botId: identity.bot.id,
      actorType: "session",
      actorId: "s1",
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "long",
      orderType: "market",
      amount: 0.004,
      price: 50000,
      leverage: 5,
      reduceOnly: false,
      status: "filled",
      filledAt: "2026-06-20T00:00:00.000Z",
    });
    expect(order.id).toBe("paper-1");

    memory.upsertPaperPosition({
      id: "default-bot:BTC/USDT:USDT:long",
      tradingAccountId: identity.tradingAccount.id,
      botId: identity.bot.id,
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      positionSide: "long",
      amount: 0.004,
      avgEntryPrice: 50000,
      markPrice: 50000,
      leverage: 5,
      marginUsdt: 40,
      unrealizedPnl: 0,
      realizedPnl: 0,
    });
    memory.insertPaperFill({
      orderId: "paper-1",
      tradingAccountId: identity.tradingAccount.id,
      botId: identity.bot.id,
      actorType: "session",
      actorId: "s1",
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "long",
      amount: 0.004,
      price: 50000,
      feeUsdt: 0,
      realizedPnl: 0,
    });

    expect(memory.listPaperOrders({ tradingAccountId: identity.tradingAccount.id })).toHaveLength(1);
    expect(memory.listPaperPositions({ tradingAccountId: identity.tradingAccount.id })[0]).toMatchObject({
      symbol: "BTC/USDT:USDT",
      positionSide: "long",
      marginUsdt: 40,
    });
    expect(memory.listPaperFills({ orderId: "paper-1" })[0]).toMatchObject({
      actorType: "session",
      actorId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
  });
});
