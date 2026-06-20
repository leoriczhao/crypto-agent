import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";

describe("resident agents and strategy mandates", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-resident-agent-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("creates a strategy mandate as a reusable resource", () => {
    const mandate = memory.createStrategyMandate({
      id: "trend_pullback_v1",
      name: "Trend Pullback",
      status: "active",
      description: "1h trend plus 15m pullback playbook",
      body: {
        style: "trend_pullback",
        required_data: ["1h_ohlcv", "15m_ohlcv"],
        entry: ["1h trend aligned", "15m pullback confirmed"],
      },
      validationStatus: "deferred",
      validationNotes: "Full mandate validation platform is deferred.",
    });

    expect(mandate).toMatchObject({
      id: "trend_pullback_v1",
      status: "active",
      validationStatus: "deferred",
      body: { style: "trend_pullback" },
    });
    expect(memory.listStrategyMandates({ status: "active" })).toHaveLength(1);
  });

  test("creates a resident trader bound to allocation and assigned mandate", () => {
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

    const agent = memory.createResidentAgent({
      id: "agent-btc-eth-paper",
      type: "trader",
      name: "BTC/ETH Paper Trader",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      capitalAllocationId: allocation.id,
      scheduleExpr: "every_30m",
      nextRun: "2099-01-01T00:00:00.000Z",
      mandate: "Trade assigned mandates only. Hold when edge is unclear.",
      toolPolicy: "trader.v1",
      riskPolicy: { max_leverage: 3, max_total_notional_usdt: 1000 },
    });
    const assignment = memory.assignMandateToAgent({
      agentId: agent.id,
      mandateId: mandate.id,
      universe: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
    });

    expect(agent).toMatchObject({
      type: "trader",
      sessionId: "resident-agent-agent-btc-eth-paper",
      capitalAllocationId: allocation.id,
      scheduleExpr: "every_30m",
      riskPolicy: { max_leverage: 3 },
    });
    expect(memory.getSession(agent.sessionId)).toMatchObject({
      id: agent.sessionId,
      type: "system",
      bot_id: identity.bot.id,
    });
    expect(assignment).toMatchObject({
      agentId: agent.id,
      mandateId: mandate.id,
      universe: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
      active: true,
    });
    expect(memory.listAgentMandateAssignments(agent.id, { activeOnly: true })).toHaveLength(1);
  });

  test("tracks agent runs and exposes the active run by session", () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const agent = memory.createResidentAgent({
      id: "agent-1",
      type: "trader",
      name: "Trader",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });

    const run = memory.createAgentRun({
      id: "run-1",
      agentId: agent.id,
      trigger: "manual",
      input: "Run one decision cycle",
      mandateIds: ["trend_pullback_v1"],
    });

    expect(run).toMatchObject({
      id: "run-1",
      status: "running",
      mandateIds: ["trend_pullback_v1"],
    });
    expect(memory.getActiveAgentRunBySessionId(agent.sessionId)?.id).toBe("run-1");

    memory.finishAgentRun("run-1", { status: "completed", summary: "held cash" });

    expect(memory.getAgentRun("run-1")).toMatchObject({
      status: "completed",
      summary: "held cash",
    });
    expect(memory.getActiveAgentRunBySessionId(agent.sessionId)).toBeNull();
  });
});
