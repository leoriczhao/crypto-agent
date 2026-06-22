import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";
import { SessionManager } from "../src/session.js";
import { ResidentAgentRuntime, nextRunFromSchedule } from "../src/agents/runtime.js";

describe("ResidentAgentRuntime", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-resident-runtime-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("computes next run timestamps from interval schedules", () => {
    expect(nextRunFromSchedule("every_30m", Date.parse("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:30:00.000Z");
    expect(nextRunFromSchedule("bad", Date.parse("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  test("runs an active resident trader without legacy mandates", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const resident = memory.createResidentAgent({
      id: "resident-package-trader",
      type: "trader",
      name: "Package Trader",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      mandate: "Supervise strategy package deployments.",
      toolPolicy: "trader.v2",
      riskPolicy: { maxLeverage: 3 },
    });
    const agent = {
      sessions: new SessionManager(),
      chatInSession: vi.fn().mockResolvedValue("PAPER run report: hold."),
    } as any;

    const runtime = new ResidentAgentRuntime({ memory, agent });

    const result = await runtime.runAgent(resident.id, "manual");

    expect(result.run).toMatchObject({
      agentId: resident.id,
      status: "completed",
      mandateIds: [],
    });
    expect(agent.chatInSession).toHaveBeenCalledWith(
      resident.sessionId,
      expect.stringContaining("Strategy Package Context"),
    );
  });

  test("runs an active resident trader and completes its run record", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const allocation = memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 2000,
    });
    const mandate = memory.createStrategyMandate({
      id: "trend_pullback_v1",
      name: "Trend Pullback",
      status: "active",
      body: { style: "trend_pullback" },
    });
    const resident = memory.createResidentAgent({
      id: "trader-1",
      type: "trader",
      name: "BTC/ETH Paper Trader",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      capitalAllocationId: allocation.id,
      scheduleExpr: "every_30m",
      riskPolicy: { max_leverage: 3 },
    });
    memory.assignMandateToAgent({
      agentId: resident.id,
      mandateId: mandate.id,
      universe: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
    });

    const agent = {
      sessions: new SessionManager(),
      chatInSession: vi.fn().mockResolvedValue("PAPER run report: hold."),
    } as any;
    const runtime = new ResidentAgentRuntime({ memory, agent });

    const result = await runtime.runAgent(resident.id, "manual");

    expect(result.response).toContain("hold");
    expect(result.run).toMatchObject({
      agentId: resident.id,
      status: "completed",
      mandateIds: ["trend_pullback_v1"],
    });
    expect(agent.chatInSession).toHaveBeenCalledWith(resident.sessionId, expect.stringContaining("Legacy Strategy Mandates"));
    expect(memory.loadRecentMessages(resident.sessionId, 10).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("resident trader prompt includes active deployments", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const allocation = memory.ensureBotAllocation({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      asset: "USDT",
      amount: 300,
    });
    const resident = memory.createResidentAgent({
      id: "resident-package-trader",
      type: "trader",
      name: "Package Trader",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      capitalAllocationId: allocation.id,
      mandate: "Supervise strategy package deployments.",
      toolPolicy: "trader.v2",
      riskPolicy: { maxLeverage: 3 },
    });
    memory.createStrategyPackage({
      id: "btc_signal",
      version: 1,
      familyId: "btc_signal",
      name: "BTC Signal",
      status: "paper_ready",
      source: "researcher",
      mandate: "Trade BTC only when condition evidence is valid.",
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
      riskPolicy: { maxLeverage: 3, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 300 },
      validationStatus: "waived",
      validationSummary: "Paper smoke waiver.",
    });
    memory.createStrategyDeployment({
      id: "deploy-btc",
      packageId: "btc_signal",
      packageVersion: 1,
      status: "active",
      mode: "PAPER",
      tradingAccountId: identity.tradingAccount.id,
      botId: identity.bot.id,
      capitalAllocationId: allocation.id,
      residentTraderId: resident.id,
      runtimePolicy: {},
    });
    memory.createStrategyInstance({
      id: "deploy-btc:btc-usdt-usdt",
      deploymentId: "deploy-btc",
      packageId: "btc_signal",
      packageVersion: 1,
      kind: "signal",
      symbol: "BTC/USDT:USDT",
      params: {},
      allocatedUsdt: 300,
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
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

    const agent = {
      sessions: new SessionManager(),
      chatInSession: vi.fn().mockResolvedValue("PAPER run report: hold."),
    } as any;
    const runtime = new ResidentAgentRuntime({ memory, agent });

    await runtime.runAgent(resident.id, "manual");

    const prompt = vi.mocked(agent.chatInSession).mock.calls[0][1];
    expect(prompt).toContain("Strategy Package Context");
    expect(prompt).toContain("Active Deployments");
    expect(prompt).toContain("deploy-btc");
    expect(prompt).toContain("btc_signal@1");
    expect(prompt).toContain("health: positions=1 open_orders=0 pending_orders=0 fills=0 margin=250 unrealized_pnl=5 realized_pnl=0");
  });
});
