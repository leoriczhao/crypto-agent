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

  test("refuses to run a trader with no active strategy mandate assignment", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const resident = memory.createResidentAgent({
      id: "trader-no-mandate",
      type: "trader",
      name: "No Mandate Trader",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
    });
    const agent = {
      sessions: new SessionManager(),
      chatInSession: vi.fn(),
    } as any;

    const runtime = new ResidentAgentRuntime({ memory, agent });

    await expect(runtime.runAgent(resident.id, "manual")).rejects.toThrow(/no active assigned strategy mandate/);
    expect(agent.chatInSession).not.toHaveBeenCalled();
    expect(memory.listAgentRuns(resident.id)).toHaveLength(0);
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
    expect(agent.chatInSession).toHaveBeenCalledWith(resident.sessionId, expect.stringContaining("Assigned Strategy Mandates"));
    expect(memory.loadRecentMessages(resident.sessionId, 10).map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
