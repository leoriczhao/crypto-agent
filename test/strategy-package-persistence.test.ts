import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";

describe("strategy package persistence", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-strategy-package-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("creates and reads immutable strategy package versions", () => {
    const pkg = memory.createStrategyPackage({
      id: "btc_eth_breakout",
      version: 1,
      familyId: "btc_eth_breakout",
      name: "BTC/ETH Breakout",
      status: "draft",
      source: "researcher",
      mandate: {
        thesis: "Trade confirmed 15m breakouts in the direction of 1h trend.",
        universe: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
      },
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
        timeframe: "15m",
        side: "long",
        entry: [{ indicator: "sma_cross", operator: "cross_above", value: 0 }],
        exit: [{ indicator: "rsi", operator: "gt", value: 70 }],
        positionSizeUsdt: 50,
        stopLossPct: 1.5,
        takeProfitPct: 3,
      },
      riskPolicy: {
        maxLeverage: 3,
        maxSingleNotionalUsdt: 100,
        maxTotalNotionalUsdt: 300,
      },
      validationStatus: "not_run",
      validationSummary: null,
      authorAgentId: "researcher-1",
      authorRunId: "run-1",
    });

    expect(pkg).toMatchObject({
      id: "btc_eth_breakout",
      version: 1,
      familyId: "btc_eth_breakout",
      status: "draft",
      source: "researcher",
      validationStatus: "not_run",
      authorAgentId: "researcher-1",
      authorRunId: "run-1",
      mandate: { thesis: "Trade confirmed 15m breakouts in the direction of 1h trend." },
      executableSpec: { kind: "signal", symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"] },
      riskPolicy: { maxLeverage: 3 },
    });

    expect(memory.getStrategyPackage("btc_eth_breakout", 1)).toMatchObject({
      id: "btc_eth_breakout",
      version: 1,
      executableSpec: { kind: "signal" },
    });
    expect(memory.listStrategyPackages({ familyId: "btc_eth_breakout" })).toHaveLength(1);

    expect(() => memory.createStrategyPackage({
      id: "btc_eth_breakout",
      version: 1,
      familyId: "btc_eth_breakout",
      name: "duplicate",
      status: "draft",
      source: "researcher",
      mandate: {},
      executableSpec: { kind: "grid" },
      riskPolicy: {},
      validationStatus: "not_run",
    })).toThrow();
  });

  test("records validation evidence and updates package validation state", () => {
    memory.createStrategyPackage({
      id: "grid_eth",
      version: 1,
      familyId: "grid_eth",
      name: "ETH Grid",
      status: "submitted",
      source: "researcher",
      mandate: { thesis: "Mean-reversion grid inside a bounded range." },
      executableSpec: {
        kind: "grid",
        symbol: "ETH/USDT:USDT",
        side: "long",
        lowerPrice: 1600,
        upperPrice: 1900,
        gridCount: 6,
        sizePerGrid: 20,
      },
      riskPolicy: { maxLeverage: 1, maxSingleNotionalUsdt: 20, maxTotalNotionalUsdt: 120 },
      validationStatus: "pending",
    });

    const validation = memory.createStrategyValidation({
      id: "validation-1",
      packageId: "grid_eth",
      packageVersion: 1,
      validatorType: "schema",
      status: "waived",
      datasetRef: null,
      metrics: { checks: ["schema", "compiler"], passed: true },
      report: "Paper-only waiver for grid smoke test.",
      createdBy: "resident-trader-1",
    });
    memory.setStrategyPackageValidation("grid_eth", 1, "waived", "Paper-only waiver for grid smoke test.");
    memory.setStrategyPackageStatus("grid_eth", 1, "paper_ready");

    expect(validation).toMatchObject({
      id: "validation-1",
      packageId: "grid_eth",
      packageVersion: 1,
      validatorType: "schema",
      status: "waived",
      metrics: { passed: true },
    });
    expect(memory.listStrategyValidations("grid_eth", 1)).toHaveLength(1);
    expect(memory.getStrategyPackage("grid_eth", 1)).toMatchObject({
      status: "paper_ready",
      validationStatus: "waived",
      validationSummary: "Paper-only waiver for grid smoke test.",
    });
  });

  test("creates deployment and strategy instance rows with bot/account attribution", () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const allocation = memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 300,
    });
    memory.createStrategyPackage({
      id: "btc_signal",
      version: 1,
      familyId: "btc_signal",
      name: "BTC Signal",
      status: "paper_ready",
      source: "researcher",
      mandate: { thesis: "Simple signal strategy." },
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
      riskPolicy: { maxLeverage: 1, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 100 },
      validationStatus: "waived",
    });

    const deployment = memory.createStrategyDeployment({
      id: "dep-1",
      packageId: "btc_signal",
      packageVersion: 1,
      status: "proposed",
      mode: "PAPER",
      tradingAccountId: identity.tradingAccount.id,
      botId: identity.bot.id,
      capitalAllocationId: allocation.id,
      residentTraderId: "resident-1",
      runtimePolicy: { close_on_stop: false },
    });
    const instance = memory.createStrategyInstance({
      id: "dep-1:btc-signal",
      deploymentId: deployment.id,
      packageId: "btc_signal",
      packageVersion: 1,
      kind: "signal",
      symbol: "BTC/USDT:USDT",
      params: { timeframe: "15m", side: "long" },
      enabled: true,
      allocatedUsdt: 100,
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });

    expect(deployment).toMatchObject({
      id: "dep-1",
      status: "proposed",
      mode: "PAPER",
      capitalAllocationId: allocation.id,
      runtimePolicy: { close_on_stop: false },
    });
    expect(instance).toMatchObject({
      id: "dep-1:btc-signal",
      deploymentId: "dep-1",
      packageId: "btc_signal",
      packageVersion: 1,
      kind: "signal",
      enabled: true,
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });

    memory.updateStrategyDeployment("dep-1", { status: "active", startedAt: "2026-06-22T00:00:00.000Z" });
    memory.updateStrategyInstance("dep-1:btc-signal", { enabled: false });

    expect(memory.getStrategyDeployment("dep-1")).toMatchObject({ status: "active" });
    expect(memory.listStrategyDeployments({ status: "active" })).toHaveLength(1);
    expect(memory.listStrategyInstances("dep-1")[0]).toMatchObject({ enabled: false });
  });

  test("strategy package schema remains clean-schema only", () => {
    const source = readFileSync(join(process.cwd(), "src/memory.ts"), "utf8");

    expect(source).not.toMatch(/ALTER\s+TABLE/i);
    expect(source).not.toContain("llm_trader_jobs");
    expect(source).not.toContain("strategy_rules");
  });
});
