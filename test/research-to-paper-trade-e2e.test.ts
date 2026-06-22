import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";
import { PaperBroker } from "../src/broker/paper-broker.js";
import { StrategyManager } from "../src/strategy/manager.js";
import { StrategyRuntime } from "../src/strategy/runtime.js";
import { StrategyDeploymentService } from "../src/strategy/deployment-service.js";
import { OrderExecutor } from "../src/strategy/executor.js";
import { RiskGate } from "../src/strategy/risk-gate.js";

class StubMarketData {
  readonly exchangeId = "okx";
  prices = new Map<string, number>([
    ["BTC/USDT:USDT", 101],
    ["ETH/USDT:USDT", 101],
  ]);

  fetchTicker = vi.fn(async (symbol: string) => {
    const last = this.prices.get(symbol) ?? 101;
    return { symbol, last, bid: last - 1, ask: last + 1, volume: 1000, timestamp: Date.now() };
  });

  fetchOhlcv = vi.fn(async () => profitableCycleOhlcv());

  fetchOrderBook = vi.fn(async () => ({ bids: [], asks: [] }));
}

function profitableCycleOhlcv() {
  const closes: number[] = [];
  for (let i = 0; i < 80; i++) closes.push(99, 101, 107, 95);
  return closes.map((close, i) => ({
    timestamp: i * 60_000,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
  }));
}

function makeFeed() {
  const feed = new EventEmitter() as any;
  feed.subscribeTicker = (symbol: string, cb: any) => feed.on(`tick:${symbol}`, cb);
  feed.subscribeOhlcv = (symbol: string, timeframe: string, cb: any) => feed.on(`candle:${symbol}:${timeframe}`, cb);
  feed.subscribeOrderBook = (symbol: string, cb: any) => feed.on(`orderbook:${symbol}`, cb);
  feed.unsubscribe = (symbol: string) => {
    for (const event of feed.eventNames()) {
      if (String(event).includes(symbol)) feed.removeAllListeners(event);
    }
  };
  return feed;
}

async function drain(promises: Promise<any>[]) {
  while (promises.length) {
    const batch = promises.splice(0);
    await Promise.all(batch);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function seedHistory(feed: EventEmitter, symbol: string, timeframe: string, count = 50) {
  for (let i = 0; i < count; i++) {
    feed.emit(`candle:${symbol}:${timeframe}`, {
      symbol,
      timeframe,
      timestamp: i * 60_000,
      open: 99,
      high: 100,
      low: 98,
      close: 99,
      volume: 1000,
    });
  }
}

describe("research package to paper trade closed loop", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    vi.resetModules();
    dbPath = join(tmpdir(), `crypto-research-paper-loop-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
    memory.createSession("audit-system", "system", "system");
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("research-created signal package validates, deploys under a resident trader, and opens a paper swap position", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");

    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.createSession("main-session", "main", "user", identity.bot.id);

    const spawned = await TOOL_HANDLERS.resident_agent({
      memory,
      sessionId: "main-session",
      action: "spawn",
      type: "trader",
      name: "BTC ETH Paper Trader",
      interval_minutes: 30,
      capital_usdt: 2000,
      symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
      risk_policy: {
        maxLeverage: 3,
        maxSingleNotionalUsdt: 100,
        maxTotalNotionalUsdt: 2000,
      },
      instructions: "Supervise validated BTC/ETH paper deployments only.",
    });
    expect(spawned).toContain("Resident agent created");

    const trader = memory.listResidentAgents({ type: "trader" })[0];
    expect(trader).toMatchObject({
      tradingAccountId: identity.tradingAccount.id,
      capitalAllocationId: `${identity.tradingAccount.id}:${trader.botId}:USDT`,
    });

    const marketData = new StubMarketData();
    const broker = new PaperBroker({
      memory,
      marketData: marketData as any,
      tradingAccountId: trader.tradingAccountId,
    });
    const feed = makeFeed();
    const manager = new StrategyManager(memory);
    const riskGate = new RiskGate({
      store: manager,
      broker,
      botId: identity.bot.id,
      initialPortfolioValue: 2000,
      memory,
    });
    const executor = new OrderExecutor({
      marketData: marketData as any,
      broker,
      feed,
      riskGate,
      store: manager,
      memory,
      paperMode: true,
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      auditSessionId: "audit-system",
    });
    const runtime = new StrategyRuntime({ feed, manager, memory, broker });
    const signalWork: Promise<any>[] = [];
    runtime.on("signal", (signal) => signalWork.push(executor.handleSignal(signal)));
    runtime.wireExecutor(executor);

    const service = new StrategyDeploymentService({ memory, manager, runtime });

    const created = await TOOL_HANDLERS.strategy_package({
      memory,
      sessionId: trader.sessionId,
      action: "create",
      id: "btc_eth_breakout_paper",
      name: "BTC/ETH Paper Breakout",
      source: "resident-researcher",
      mandate: {
        thesis: "Use a tiny paper-only breakout signal to verify research-to-execution plumbing.",
        universe: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
      },
      executable_spec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
        timeframe: "1m",
        side: "long",
        entry: [{ indicator: "price_level", operator: "gt", value: 100 }],
        exit: [{ indicator: "price_level", operator: "gt", value: 105 }],
        positionSizeUsdt: 100,
        leverage: 2,
        stopLossPct: 2,
        takeProfitPct: 4,
      },
      risk_policy: {
        maxLeverage: 3,
        maxSingleNotionalUsdt: 100,
        maxTotalNotionalUsdt: 2000,
      },
    });
    expect(created).toContain("Strategy package created");

    const validated = await TOOL_HANDLERS.validate_strategy({
      memory,
      market_data: marketData,
      action: "run",
      package_id: "btc_eth_breakout_paper",
      package_version: 1,
      created_by: "resident-researcher",
    });
    expect(validated).toContain("validation=passed");
    expect(memory.getStrategyPackage("btc_eth_breakout_paper", 1)).toMatchObject({
      status: "paper_ready",
      validationStatus: "passed",
    });

    const deployed = await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      sessionId: "main-session",
      action: "activate",
      deployment_id: "paper-closed-loop",
      package_id: "btc_eth_breakout_paper",
      package_version: 1,
      mode: "PAPER",
      resident_trader_id: trader.id,
    });
    expect(deployed).toContain("Strategy deployment active");

    const deployment = memory.getStrategyDeployment("paper-closed-loop");
    expect(deployment).toMatchObject({
      botId: trader.botId,
      tradingAccountId: trader.tradingAccountId,
      capitalAllocationId: trader.capitalAllocationId,
      residentTraderId: trader.id,
      status: "active",
    });
    expect(memory.listStrategyInstances("paper-closed-loop")).toHaveLength(2);

    seedHistory(feed, "BTC/USDT:USDT", "1m");
    seedHistory(feed, "ETH/USDT:USDT", "1m");
    marketData.prices.set("BTC/USDT:USDT", 101);
    feed.emit("tick:BTC/USDT:USDT", {
      symbol: "BTC/USDT:USDT",
      last: 101,
      bid: 100,
      ask: 102,
      volume: 1000,
      timestamp: Date.now(),
    });
    await drain(signalWork);

    const btcInstance = memory.getStrategyInstance("paper-closed-loop:btc-usdt-usdt");
    expect(btcInstance).toBeTruthy();
    const orders = memory.listPaperOrders({ tradingAccountId: trader.tradingAccountId, botId: trader.botId });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      actorType: "strategy",
      actorId: btcInstance!.id,
      capitalAllocationId: trader.capitalAllocationId,
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "long",
      orderType: "market",
      leverage: 2,
      reduceOnly: false,
      status: "filled",
    });

    const fills = memory.listPaperFills({ tradingAccountId: trader.tradingAccountId, botId: trader.botId });
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      orderId: orders[0].id,
      actorType: "strategy",
      actorId: btcInstance!.id,
      capitalAllocationId: trader.capitalAllocationId,
      marketType: "swap",
      positionSide: "long",
    });

    const positions = await broker.fetchPositions(trader.botId);
    expect(positions["BTC/USDT:USDT:long"]).toMatchObject({
      marketType: "swap",
      side: "long",
      avg_entry_price: 101,
      leverage: 2,
      margin_usdt: 50,
    });

    const state = memory.getStrategyRuntimeState(btcInstance!.id);
    expect(state?.lastSignal).toMatchObject({
      symbol: "BTC/USDT:USDT",
      action: "enter",
      leverage: 2,
      sizeUsdt: 100,
    });

    const [trade] = memory.getRecentTrades(1);
    expect(trade).toMatchObject({
      strategy_id: btcInstance!.id,
      botId: trader.botId,
      tradingAccountId: trader.tradingAccountId,
      capitalAllocationId: trader.capitalAllocationId,
      symbol: "BTC/USDT:USDT",
      side: "buy",
      mode: "PAPER",
    });
  });
});
