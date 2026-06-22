import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";
import { StrategyManager } from "../src/strategy/manager.js";
import { StrategyDeploymentService } from "../src/strategy/deployment-service.js";

describe("strategy package tools", () => {
  let dbPath: string;
  let memory: Memory;
  let service: StrategyDeploymentService;

  beforeEach(() => {
    vi.resetModules();
    dbPath = join(tmpdir(), `crypto-strategy-package-tools-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
    const manager = new StrategyManager(memory);
    service = new StrategyDeploymentService({
      memory,
      manager,
      runtime: { startOne: vi.fn(), stopOne: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  function makeOhlcv(closes: number[]) {
    return closes.map((close, i) => ({
      timestamp: i * 3600000,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1000,
    }));
  }

  function profitableCycleOhlcv() {
    const closes: number[] = [];
    for (let i = 0; i < 60; i++) closes.push(99, 101, 107, 95);
    return makeOhlcv(closes);
  }

  test("creates, validates, deploys, and lists a strategy package", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.createSession("user-session", "user", "user", identity.bot.id);

    const created = await TOOL_HANDLERS.strategy_package({
      memory,
      sessionId: "user-session",
      action: "create",
      id: "btc_eth_signal",
      name: "BTC/ETH Signal",
      source: "researcher",
      mandate: { thesis: "Trade RSI pullbacks in trend direction." },
      executable_spec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
        timeframe: "15m",
        side: "long",
        entry: [{ indicator: "rsi", operator: "lt", value: 35 }],
        exit: [{ indicator: "rsi", operator: "gt", value: 60 }],
        positionSizeUsdt: 50,
        stopLossPct: 1.5,
        takeProfitPct: 3,
      },
      risk_policy: { maxLeverage: 1, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 300 },
    });

    expect(created).toContain("Strategy package created");
    expect(memory.getStrategyPackage("btc_eth_signal", 1)).toMatchObject({
      id: "btc_eth_signal",
      status: "draft",
      validationStatus: "not_run",
    });

    const waived = await TOOL_HANDLERS.validate_strategy({
      memory,
      action: "waive_for_paper",
      package_id: "btc_eth_signal",
      package_version: 1,
      report: "Paper smoke test waiver.",
      created_by: "resident-trader",
    });

    expect(waived).toContain("validation=waived");
    expect(memory.getStrategyPackage("btc_eth_signal", 1)).toMatchObject({
      status: "paper_ready",
      validationStatus: "waived",
    });

    const deployed = await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      sessionId: "user-session",
      action: "activate",
      package_id: "btc_eth_signal",
      package_version: 1,
      mode: "PAPER",
      capital_usdt: 300,
    });

    expect(deployed).toContain("Strategy deployment active");
    expect(memory.listStrategyDeployments({ status: "active" })).toHaveLength(1);
    expect(memory.listStrategyInstances()).toHaveLength(2);

    const status = await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      action: "status",
    });

    expect(status).toContain("btc_eth_signal");
    expect(status).toContain("active");
    expect(status).toContain("Instances:");
    expect(status).toContain("btc-usdt-usdt");
    expect(status).toContain("allocated=150");
  });

  test("deployment status includes paper trading health for owned instances", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.createSession("user-session", "user", "user", identity.bot.id);
    memory.createStrategyPackage({
      id: "btc_eth_signal",
      version: 1,
      familyId: "btc_eth_signal",
      name: "BTC/ETH Signal",
      status: "paper_ready",
      source: "researcher",
      mandate: { thesis: "Trade pullbacks." },
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
        timeframe: "15m",
        side: "long",
        entry: [{ indicator: "rsi", operator: "lt", value: 35 }],
        exit: [{ indicator: "rsi", operator: "gt", value: 60 }],
        positionSizeUsdt: 50,
        stopLossPct: 1.5,
        takeProfitPct: 3,
      },
      riskPolicy: { maxLeverage: 1, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 300 },
      validationStatus: "waived",
      validationSummary: "Paper smoke waiver.",
    });

    await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      sessionId: "user-session",
      action: "activate",
      deployment_id: "deploy-health",
      package_id: "btc_eth_signal",
      package_version: 1,
      mode: "PAPER",
      capital_usdt: 300,
    });

    const [btcInstance] = memory.listStrategyInstances("deploy-health");
    expect(btcInstance).toBeTruthy();
    memory.upsertPaperPosition({
      id: `${identity.tradingAccount.id}:${identity.bot.id}:BTC/USDT:USDT:long`,
      tradingAccountId: identity.tradingAccount.id,
      botId: identity.bot.id,
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      positionSide: "long",
      amount: 0.01,
      avgEntryPrice: 50000,
      markPrice: 50500,
      leverage: 2,
      marginUsdt: 250,
      unrealizedPnl: 5,
      realizedPnl: 0,
    });
    memory.createPaperOrder({
      id: "paper-open-1",
      tradingAccountId: identity.tradingAccount.id,
      botId: identity.bot.id,
      actorType: "strategy",
      actorId: btcInstance.id,
      capitalAllocationId: `${identity.tradingAccount.id}:${identity.bot.id}:USDT`,
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "buy",
      positionSide: "long",
      orderType: "limit",
      amount: 0.01,
      price: 49000,
      leverage: 2,
      status: "open",
    });
    memory.insertPaperFill({
      orderId: "paper-fill-1",
      tradingAccountId: identity.tradingAccount.id,
      botId: identity.bot.id,
      actorType: "strategy",
      actorId: btcInstance.id,
      capitalAllocationId: `${identity.tradingAccount.id}:${identity.bot.id}:USDT`,
      symbol: "BTC/USDT:USDT",
      marketType: "swap",
      side: "sell",
      positionSide: "long",
      amount: 0.01,
      price: 50600,
      realizedPnl: 6,
    });
    memory.createPendingOrder({
      strategyId: btcInstance.id,
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      positionId: btcInstance.id,
      action: "enter",
      symbol: "BTC/USDT:USDT",
      side: "buy",
      orderType: "limit",
      price: 49000,
      amount: 0.01,
      exchangeOrderId: "paper-open-1",
    });
    (memory as any).recordStrategySignal(btcInstance.id, {
      ruleId: btcInstance.id,
      symbol: "BTC/USDT:USDT",
      side: "long",
      action: "enter",
      sizeUsdt: 50,
      reason: "RSI pullback",
      timestamp: 1700000000000,
      orderType: "limit",
      limitPrice: 49000,
    });
    (memory as any).recordStrategyError(btcInstance.id, "risk gate rejected oversize order");

    const status = await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      action: "status",
    });

    expect(status).toContain("Paper: positions=1 open_orders=1 pending_orders=1 fills=1 margin=250 unrealized_pnl=5 realized_pnl=6");
    expect(status).toContain("Position: BTC/USDT:USDT long amount=0.01 entry=50000 mark=50500 margin=250 uPnL=5");
    expect(status).toContain(`OpenOrder: paper-open-1 buy limit BTC/USDT:USDT amount=0.01 price=49000 actor=${btcInstance.id}`);
    expect(status).toContain("PendingOrder: paper-open-1 buy limit BTC/USDT:USDT amount=0.01 price=49000 strategy=");
    expect(status).toContain("Fill: paper-fill-1 sell BTC/USDT:USDT amount=0.01 price=50600 realized_pnl=6");
    expect(status).toContain("LastSignal: BTC/USDT:USDT enter long size=50 order=limit price=49000 reason=RSI pullback");
    expect(status).toContain("LastError: risk gate rejected oversize order");
  });

  test("stops a strategy deployment with correct status wording", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.createSession("user-session", "user", "user", identity.bot.id);
    memory.createStrategyPackage({
      id: "btc_signal",
      version: 1,
      familyId: "btc_signal",
      name: "BTC Signal",
      status: "paper_ready",
      source: "researcher",
      mandate: "Trade BTC RSI pullbacks.",
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT"],
        timeframe: "15m",
        side: "long",
        entry: [{ indicator: "rsi", operator: "lt", value: 35 }],
        exit: [{ indicator: "rsi", operator: "gt", value: 60 }],
        positionSizeUsdt: 50,
        stopLossPct: 1.5,
        takeProfitPct: 3,
      },
      riskPolicy: { maxLeverage: 1, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 300 },
      validationStatus: "waived",
      validationSummary: "Paper smoke waiver.",
    });

    await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      sessionId: "user-session",
      action: "activate",
      deployment_id: "deploy-1",
      package_id: "btc_signal",
      package_version: 1,
      mode: "PAPER",
      capital_usdt: 300,
    });

    const stopped = await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      action: "stop",
      deployment_id: "deploy-1",
    });

    expect(stopped).toContain("stopped");
    expect(stopped).not.toContain("stopd");
  });

  test("revises a strategy package into the next immutable version", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    memory.createStrategyPackage({
      id: "btc_signal",
      version: 1,
      familyId: "btc_signal",
      name: "BTC Signal",
      status: "paper_ready",
      source: "researcher",
      mandate: { thesis: "Use RSI pullbacks." },
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT"],
        timeframe: "1h",
        side: "long",
        entry: [{ indicator: "rsi", operator: "lt", value: 35 }],
        exit: [{ indicator: "rsi", operator: "gt", value: 55 }],
        positionSizeUsdt: 50,
        stopLossPct: 3,
        takeProfitPct: 5,
      },
      riskPolicy: { maxLeverage: 3, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 150 },
      validationStatus: "waived",
      validationSummary: "Paper waiver.",
    });

    const revised = await TOOL_HANDLERS.strategy_package({
      memory,
      action: "revise",
      id: "btc_signal",
      version: 1,
      name: "BTC Signal v2",
      source: "resident-researcher",
      mandate: { thesis: "Use stricter RSI pullbacks." },
      executable_spec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT"],
        timeframe: "1h",
        side: "long",
        entry: [{ indicator: "rsi", operator: "lt", value: 30 }],
        exit: [{ indicator: "rsi", operator: "gt", value: 60 }],
        positionSizeUsdt: 40,
        stopLossPct: 2,
        takeProfitPct: 4,
      },
      risk_policy: { maxLeverage: 2, maxSingleNotionalUsdt: 40, maxTotalNotionalUsdt: 120 },
    });

    expect(revised).toContain("btc_signal@2");
    expect(memory.getStrategyPackage("btc_signal", 1)).toMatchObject({
      id: "btc_signal",
      version: 1,
      familyId: "btc_signal",
      name: "BTC Signal",
      status: "paper_ready",
      validationStatus: "waived",
      executableSpec: { entry: [{ indicator: "rsi", operator: "lt", value: 35 }] },
      riskPolicy: { maxLeverage: 3 },
    });
    expect(memory.getStrategyPackage("btc_signal", 2)).toMatchObject({
      id: "btc_signal",
      version: 2,
      familyId: "btc_signal",
      name: "BTC Signal v2",
      status: "draft",
      source: "resident-researcher",
      validationStatus: "not_run",
      validationSummary: null,
      mandate: { thesis: "Use stricter RSI pullbacks." },
      executableSpec: { entry: [{ indicator: "rsi", operator: "lt", value: 30 }], positionSizeUsdt: 40 },
      riskPolicy: { maxLeverage: 2, maxTotalNotionalUsdt: 120 },
    });
  });

  test("checks live strategy deployment without activating it", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    memory.createStrategyPackage({
      id: "btc_live_signal",
      version: 1,
      familyId: "btc_live_signal",
      name: "BTC Live Signal",
      status: "live_ready",
      source: "researcher",
      mandate: { thesis: "Trade only after passed validation." },
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT"],
        timeframe: "1h",
        side: "long",
        entry: [{ indicator: "rsi", operator: "lt", value: 30 }],
        exit: [{ indicator: "rsi", operator: "gt", value: 60 }],
        positionSizeUsdt: 40,
        stopLossPct: 2,
        takeProfitPct: 4,
      },
      riskPolicy: { maxLeverage: 2, maxSingleNotionalUsdt: 40, maxTotalNotionalUsdt: 120 },
      validationStatus: "passed",
      validationSummary: "Backtest passed.",
    });

    const result = await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      action: "check",
      package_id: "btc_live_signal",
      package_version: 1,
      mode: "LIVE",
      capital_usdt: 300,
      runtime_policy: { live_approved: true },
      config: {
        contractMarginMode: "isolated",
        contractPositionMode: "hedge",
        contractMaxLeverage: 5,
      },
    });

    expect(result).toContain("Strategy deployment check: ok");
    expect(result).toContain("mode=LIVE");
    expect(result).toContain("package=btc_live_signal@1");
    expect(result).toContain("instances=btc_live_signal:btc-usdt-usdt[signal:BTC/USDT:USDT]");
    expect(result).toContain("margin_mode=isolated");
    expect(result).toContain("position_mode=hedge");
    expect(result).toContain("live_approved=true");
    expect(memory.listStrategyDeployments()).toHaveLength(0);
    expect(memory.listStrategyInstances()).toHaveLength(0);
  });

  test("blocks live activation without explicit approval", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "LIVE", name: "default" });
    memory.createSession("user-session", "user", "user", identity.bot.id);
    memory.createStrategyPackage({
      id: "btc_live_signal",
      version: 1,
      familyId: "btc_live_signal",
      name: "BTC Live Signal",
      status: "live_ready",
      source: "researcher",
      mandate: { thesis: "Trade only after passed validation." },
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT"],
        timeframe: "1h",
        side: "long",
        entry: [{ indicator: "rsi", operator: "lt", value: 30 }],
        exit: [{ indicator: "rsi", operator: "gt", value: 60 }],
        positionSizeUsdt: 40,
        stopLossPct: 2,
        takeProfitPct: 4,
      },
      riskPolicy: { maxLeverage: 2, maxSingleNotionalUsdt: 40, maxTotalNotionalUsdt: 120 },
      validationStatus: "passed",
      validationSummary: "Backtest passed.",
    });

    const result = await TOOL_HANDLERS.deploy_strategy({
      memory,
      strategy_deployment_service: service,
      sessionId: "user-session",
      action: "activate",
      package_id: "btc_live_signal",
      package_version: 1,
      mode: "LIVE",
      capital_usdt: 300,
    });

    expect(result).toContain("live_approved");
    expect(memory.listStrategyDeployments()).toHaveLength(0);
    expect(memory.listStrategyInstances()).toHaveLength(0);
  });

  test("runs signal validation backtest and marks package paper ready", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    memory.createStrategyPackage({
      id: "btc_signal",
      version: 1,
      familyId: "btc_signal",
      name: "BTC Signal",
      status: "submitted",
      source: "researcher",
      mandate: "Trade BTC breakouts with evidence.",
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT"],
        timeframe: "1h",
        side: "long",
        entry: [{ indicator: "price_level", operator: "gt", value: 100 }],
        exit: [{ indicator: "price_level", operator: "gt", value: 105 }],
        positionSizeUsdt: 50,
        stopLossPct: 3,
        takeProfitPct: 5,
      },
      riskPolicy: { maxLeverage: 3, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 300 },
    });
    const marketData = {
      fetchOhlcv: vi.fn().mockResolvedValue(profitableCycleOhlcv()),
    };

    const result = await TOOL_HANDLERS.validate_strategy({
      memory,
      market_data: marketData,
      action: "run",
      package_id: "btc_signal",
      package_version: 1,
      created_by: "validator-test",
    });

    expect(result).toContain("validation=passed");
    expect(result).toContain("backtest");
    expect(memory.getStrategyPackage("btc_signal", 1)).toMatchObject({
      status: "paper_ready",
      validationStatus: "passed",
    });
    const validation = memory.listStrategyValidations("btc_signal", 1)[0];
    expect(validation.validatorType).toBe("backtest_signal");
    expect(validation.metrics.backtests[0]).toMatchObject({
      symbol: "BTC/USDT:USDT",
      timeframe: "1h",
      passed: true,
    });
  });

  test("fails signal validation when backtest evidence misses thresholds", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    memory.createStrategyPackage({
      id: "flat_signal",
      version: 1,
      familyId: "flat_signal",
      name: "Flat Signal",
      status: "submitted",
      source: "researcher",
      mandate: "Impossible signal for failure testing.",
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT"],
        timeframe: "1h",
        side: "long",
        entry: [{ indicator: "price_level", operator: "gt", value: 200 }],
        exit: [{ indicator: "price_level", operator: "gt", value: 300 }],
        positionSizeUsdt: 50,
        stopLossPct: 3,
        takeProfitPct: 5,
      },
      riskPolicy: { maxLeverage: 3, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 300 },
    });
    const marketData = {
      fetchOhlcv: vi.fn().mockResolvedValue(makeOhlcv(Array.from({ length: 120 }, () => 100))),
    };

    const result = await TOOL_HANDLERS.validate_strategy({
      memory,
      market_data: marketData,
      action: "run",
      package_id: "flat_signal",
      package_version: 1,
    });

    expect(result).toContain("validation=failed");
    expect(memory.getStrategyPackage("flat_signal", 1)).toMatchObject({
      status: "submitted",
      validationStatus: "failed",
    });
    expect(memory.listStrategyValidations("flat_signal", 1)[0].metrics.backtests[0].passed).toBe(false);
  });

  test("does not approve grid packages without explicit paper waiver", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    memory.createStrategyPackage({
      id: "eth_grid",
      version: 1,
      familyId: "eth_grid",
      name: "ETH Grid",
      status: "submitted",
      source: "researcher",
      mandate: "Paper grid experiment.",
      executableSpec: {
        kind: "grid",
        symbol: "ETH/USDT:USDT",
        side: "long",
        lowerPrice: 2000,
        upperPrice: 2400,
        gridCount: 5,
        sizePerGrid: 20,
      },
      riskPolicy: { maxLeverage: 1, maxSingleNotionalUsdt: 20, maxTotalNotionalUsdt: 100 },
    });

    const result = await TOOL_HANDLERS.validate_strategy({
      memory,
      action: "run",
      package_id: "eth_grid",
      package_version: 1,
    });

    expect(result).toContain("validation=pending");
    expect(result).toContain("waive_for_paper");
    expect(memory.getStrategyPackage("eth_grid", 1)).toMatchObject({
      status: "submitted",
      validationStatus: "pending",
    });
  });
});
