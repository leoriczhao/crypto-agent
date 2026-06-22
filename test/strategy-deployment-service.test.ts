import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";
import { StrategyManager } from "../src/strategy/manager.js";
import { StrategyDeploymentService } from "../src/strategy/deployment-service.js";

function makeTempDb(): string {
  return join(tmpdir(), `crypto-strategy-deployment-${randomUUID().slice(0, 8)}.db`);
}

function createSignalPackage(memory: Memory, status = "paper_ready", validationStatus = "waived") {
  return memory.createStrategyPackage({
    id: "btc_eth_signal",
    version: 1,
    familyId: "btc_eth_signal",
    name: "BTC/ETH Signal",
    status: status as any,
    source: "test",
    mandate: { thesis: "Trend signal" },
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
    validationStatus: validationStatus as any,
  });
}

describe("StrategyDeploymentService", () => {
  let dbPath: string;
  let memory: Memory;
  let manager: StrategyManager;
  let runtime: { startOne: ReturnType<typeof vi.fn>; stopOne: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    dbPath = makeTempDb();
    memory = new Memory(dbPath);
    manager = new StrategyManager(memory);
    runtime = {
      startOne: vi.fn(),
      stopOne: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("activates a paper deployment and starts compiled strategy instances", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const allocation = memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 300,
    });
    createSignalPackage(memory);
    const service = new StrategyDeploymentService({ memory, manager, runtime });

    const result = await service.activate({
      id: "dep-1",
      packageId: "btc_eth_signal",
      packageVersion: 1,
      mode: "PAPER",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      capitalAllocationId: allocation.id,
      allocatedUsdt: 300,
      residentTraderId: "resident-1",
    });

    expect(result.deployment).toMatchObject({
      id: "dep-1",
      status: "active",
      mode: "PAPER",
      botId: identity.bot.id,
      capitalAllocationId: allocation.id,
      residentTraderId: "resident-1",
    });
    expect(result.instances).toHaveLength(2);
    expect(memory.listStrategyInstances("dep-1")).toHaveLength(2);
    expect(manager.getStrategy("dep-1:btc-usdt-usdt")).toBeDefined();
    expect(manager.getStrategy("dep-1:eth-usdt-usdt")).toBeDefined();
    expect(runtime.startOne).toHaveBeenCalledTimes(2);
  });

  test("pauses and stops deployment strategies", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const allocation = memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 300,
    });
    createSignalPackage(memory);
    const service = new StrategyDeploymentService({ memory, manager, runtime });
    await service.activate({
      id: "dep-1",
      packageId: "btc_eth_signal",
      packageVersion: 1,
      mode: "PAPER",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      capitalAllocationId: allocation.id,
      allocatedUsdt: 300,
    });

    await service.pause("dep-1");

    expect(memory.getStrategyDeployment("dep-1")).toMatchObject({ status: "paused" });
    expect(memory.listStrategyInstances("dep-1").every((i) => !i.enabled)).toBe(true);
    expect(manager.getStrategy("dep-1:btc-usdt-usdt")?.enabled).toBe(false);
    expect(runtime.stopOne).toHaveBeenCalledWith("dep-1:btc-usdt-usdt");

    await service.stop("dep-1");

    expect(memory.getStrategyDeployment("dep-1")).toMatchObject({ status: "stopped" });
    expect(memory.getStrategyDeployment("dep-1")?.stoppedAt).not.toBeNull();
  });

  test("starts active deployments after a runtime restart", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const allocation = memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 300,
    });
    createSignalPackage(memory);
    const service = new StrategyDeploymentService({ memory, manager, runtime });
    await service.activate({
      id: "dep-1",
      packageId: "btc_eth_signal",
      packageVersion: 1,
      mode: "PAPER",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      capitalAllocationId: allocation.id,
      allocatedUsdt: 300,
    });

    const restartedManager = new StrategyManager(memory);
    const restartedRuntime = {
      startOne: vi.fn(),
      stopOne: vi.fn().mockResolvedValue(undefined),
    };
    const restartedService = new StrategyDeploymentService({
      memory,
      manager: restartedManager,
      runtime: restartedRuntime,
    });

    restartedService.startActiveDeployments();

    expect(restartedRuntime.startOne).toHaveBeenCalledTimes(2);
    expect(restartedManager.getStrategy("dep-1:btc-usdt-usdt")).toBeDefined();
    expect(restartedManager.getStrategy("dep-1:eth-usdt-usdt")).toBeDefined();
  });

  test("blocks activation when package is not deployable", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const allocation = memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 300,
    });
    createSignalPackage(memory, "draft", "not_run");
    const service = new StrategyDeploymentService({ memory, manager, runtime });

    await expect(service.activate({
      packageId: "btc_eth_signal",
      packageVersion: 1,
      mode: "PAPER",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      capitalAllocationId: allocation.id,
    })).rejects.toThrow(/paper_ready/);

    expect(memory.listStrategyDeployments()).toHaveLength(0);
    expect(runtime.startOne).not.toHaveBeenCalled();
  });
});
