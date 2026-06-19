import { describe, test, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory } from "../src/memory.js";

function makeTempDb(): string {
  return join(tmpdir(), `crypto-agent-test-${randomUUID()}.db`);
}

describe("Memory", () => {
  let mem: Memory;

  afterEach(() => {
    mem?.close();
  });

  test("session CRUD", () => {
    mem = new Memory(makeTempDb());
    mem.createSession("s1", "user", "user");
    mem.createSession("s2", "system", "system");
    const sessions = mem.listSessions();
    expect(sessions).toHaveLength(2);

    const userSessions = mem.listSessions("user");
    expect(userSessions).toHaveLength(1);
    expect(userSessions[0].name).toBe("user");

    const found = mem.getSessionByName("system");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("s2");
  });

  test("save and load messages with sessionId", () => {
    mem = new Memory(makeTempDb());
    mem.createSession("s1", "user", "user");
    mem.createSession("s2", "system", "system");

    mem.saveMessage("s1", "user", "hello from user");
    mem.saveMessage("s1", "assistant", "hi there");
    mem.saveMessage("s2", "user", "heartbeat check");

    const userMsgs = mem.loadRecentMessages("s1", 10);
    expect(userMsgs).toHaveLength(2);
    expect(userMsgs[0].role).toBe("user");
    expect(userMsgs[0].content).toBe("hello from user");

    const sysMsgs = mem.loadRecentMessages("s2", 10);
    expect(sysMsgs).toHaveLength(1);
    expect(sysMsgs[0].content).toBe("heartbeat check");
  });

  test("trade journal", () => {
    mem = new Memory(makeTempDb());
    mem.createSession("s1", "user", "user");
    mem.logTrade("s1", {
      symbol: "BTC/USDT",
      side: "buy",
      amount: 0.5,
      price: 65000,
      order_type: "market",
      mode: "PAPER",
    });
    mem.logTrade("s1", {
      symbol: "ETH/USDT",
      side: "sell",
      amount: 2,
      price: 3500,
    });

    const trades = mem.getRecentTrades(10);
    expect(trades).toHaveLength(2);
    expect(trades[0].symbol).toBe("ETH/USDT");
    expect(trades[1].symbol).toBe("BTC/USDT");

    const sessionTrades = mem.getTradesBySession("s1");
    expect(sessionTrades).toHaveLength(2);
  });

  test("session summaries", () => {
    mem = new Memory(makeTempDb());
    mem.createSession("s1", "user", "user");
    mem.saveSessionSummary("s1", "User discussed BTC entry at $65k");
    mem.saveSessionSummary("s1", "Followed up with ETH analysis");

    const summaries = mem.getSessionSummaries("s1");
    expect(summaries).toHaveLength(2);
    expect(summaries[0].summary).toContain("ETH");
  });

  test("deleteSession cascades conversations and summaries", () => {
    mem = new Memory(makeTempDb());
    mem.createSession("s1", "temp", "user");
    mem.saveMessage("s1", "user", "msg");
    mem.saveSessionSummary("s1", "summary");
    mem.deleteSession("s1");

    expect(mem.getSession("s1")).toBeNull();
    expect(mem.loadRecentMessages("s1")).toHaveLength(0);
    expect(mem.getSessionSummaries("s1")).toHaveLength(0);
  });

  test("touchSession updates last_active_at", () => {
    mem = new Memory(makeTempDb());
    mem.createSession("s1", "user", "user");
    const before = mem.getSession("s1")!.last_active_at;
    mem.touchSession("s1");
    const after = mem.getSession("s1")!.last_active_at;
    expect(after).toBeDefined();
    expect(after >= before).toBe(true);
  });

  test("cron job lifecycle", () => {
    mem = new Memory(makeTempDb());
    const jobId = mem.addCronJob("check BTC", "every_60m", "2020-01-01T00:00:00");
    const jobs = mem.getDueCronJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].description).toBe("check BTC");
    mem.deleteCronJob(jobId);
    expect(mem.listCronJobs()).toHaveLength(0);
  });

  test("logEvent does not throw", () => {
    mem = new Memory(makeTempDb());
    expect(() => mem.logEvent("heartbeat", "all clear")).not.toThrow();
  });

  test("createSession with OR IGNORE handles duplicates", () => {
    mem = new Memory(makeTempDb());
    mem.createSession("s1", "user", "user");
    expect(() => mem.createSession("s1", "user", "user")).not.toThrow();
  });

  test("identity default seed creates funding account, trading account, and bot", () => {
    mem = new Memory(makeTempDb());

    const identity = mem.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });

    expect(identity.fundingAccount.id).toBe("default-funding");
    expect(identity.tradingAccount.id).toBe("default-trading-okx-paper");
    expect(identity.tradingAccount.fundingAccountId).toBe(identity.fundingAccount.id);
    expect(identity.tradingAccount.exchangeId).toBe("okx");
    expect(identity.tradingAccount.mode).toBe("PAPER");
    expect(identity.bot.id).toBe("default-bot");
    expect(identity.bot.tradingAccountId).toBe(identity.tradingAccount.id);
    expect(identity.bot.status).toBe("active");

    const bots = mem.listTradingBots();
    expect(bots).toHaveLength(1);
    expect(mem.getDefaultBot()!.id).toBe("default-bot");
  });

  test("identity session binding is explicit and idempotent", () => {
    mem = new Memory(makeTempDb());
    const identity = mem.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });
    mem.createSession("s1", "user", "user");

    expect(mem.getSessionBinding("s1")).toBeNull();
    mem.bindSessionToBot("s1", identity.bot.id);
    mem.bindSessionToBot("s1", identity.bot.id);

    const binding = mem.getSessionBinding("s1");
    expect(binding).toMatchObject({
      sessionId: "s1",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      fundingAccountId: identity.fundingAccount.id,
    });
  });

  test("identity fields can be stored on trade journal rows", () => {
    mem = new Memory(makeTempDb());
    const identity = mem.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });
    mem.createSession("s1", "user", "user");

    mem.logTrade("s1", {
      symbol: "BTC/USDT",
      side: "buy",
      amount: 0.5,
      price: 65000,
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });

    const trades = mem.getRecentTrades(1);
    expect(trades[0].botId).toBe(identity.bot.id);
    expect(trades[0].tradingAccountId).toBe(identity.tradingAccount.id);
  });

  test("identity defaults are applied to trade rows when caller omits them", () => {
    mem = new Memory(makeTempDb());
    const identity = mem.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });
    mem.createSession("s1", "user", "user");

    mem.logTrade("s1", {
      symbol: "ETH/USDT",
      side: "sell",
      amount: 2,
      price: 3500,
    });

    const trades = mem.getRecentTrades(1);
    expect(trades[0].botId).toBe(identity.bot.id);
    expect(trades[0].tradingAccountId).toBe(identity.tradingAccount.id);
  });

  test("identity seed does not backfill pre-existing unbound sessions or trades", () => {
    mem = new Memory(makeTempDb());
    mem.createSession("s1", "user", "user");
    mem.logTrade("s1", {
      symbol: "BTC/USDT",
      side: "buy",
      amount: 0.5,
      price: 65000,
    });

    mem.ensureDefaultIdentity({
      exchangeId: "okx",
      mode: "PAPER",
      name: "default",
    });

    expect(mem.getSessionBinding("s1")).toBeNull();
    const trades = mem.getRecentTrades(1);
    expect(trades[0].botId).toBeNull();
    expect(trades[0].tradingAccountId).toBeNull();
  });
});
