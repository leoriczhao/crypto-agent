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
