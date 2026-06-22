import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";

describe("resident_agent tool", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    vi.resetModules();
    dbPath = join(tmpdir(), `crypto-resident-tool-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("spawns a resident trader with a dedicated bot, allocation, schedule, and mandate assignment", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.createSession("user-session", "user", "user", identity.bot.id);
    const mandate = memory.createStrategyMandate({
      id: "trend_pullback_v1",
      name: "Trend Pullback",
      status: "active",
      body: { style: "trend_pullback" },
      validationStatus: "deferred",
      validationNotes: "Backtest platform is deferred.",
    });

    const result = await TOOL_HANDLERS.resident_agent({
      memory,
      sessionId: "user-session",
      action: "spawn",
      type: "trader",
      name: "BTC/ETH Paper Trader",
      mandate_id: mandate.id,
      interval_minutes: 30,
      capital_usdt: 2000,
      symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
      risk_policy: { max_leverage: 3, max_total_notional_usdt: 1000 },
      instructions: "Trade assigned mandates only; hold when edge is unclear.",
    });

    expect(result).toContain("Resident agent created");
    const agent = memory.listResidentAgents({ type: "trader" })[0];
    expect(agent).toMatchObject({
      type: "trader",
      name: "BTC/ETH Paper Trader",
      status: "active",
      tradingAccountId: identity.tradingAccount.id,
      scheduleExpr: "every_30m",
      riskPolicy: { max_leverage: 3, max_total_notional_usdt: 1000 },
    });
    expect(agent.botId).not.toBe(identity.bot.id);
    expect(agent.capitalAllocationId).toBe(`${identity.tradingAccount.id}:${agent.botId}:USDT`);
    expect(agent.nextRun).toEqual(expect.any(String));
    expect(memory.getTradingBot(agent.botId)).toMatchObject({
      id: agent.botId,
      tradingAccountId: identity.tradingAccount.id,
      name: "BTC/ETH Paper Trader",
    });
    expect(memory.getBotAllocation(agent.botId, identity.tradingAccount.id, "USDT")).toMatchObject({
      allocated: 2000,
      free: 2000,
    });
    expect(memory.listAgentMandateAssignments(agent.id, { activeOnly: true })[0]).toMatchObject({
      mandateId: mandate.id,
      universe: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
    });
  });

  test("refuses to spawn a trader with an invalid legacy mandate id", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.createSession("user-session", "user", "user", identity.bot.id);

    const result = await TOOL_HANDLERS.resident_agent({
      memory,
      sessionId: "user-session",
      action: "spawn",
      type: "trader",
      name: "Invalid Legacy Mandate Trader",
      mandate_id: "missing-mandate",
      interval_minutes: 30,
      capital_usdt: 2000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("legacy mandate_id");
    expect(memory.listResidentAgents()).toHaveLength(0);
  });

  test("spawns a resident trader without a legacy mandate", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.createSession("user-session", "user", "user", identity.bot.id);

    const result = await TOOL_HANDLERS.resident_agent({
      memory,
      sessionId: "user-session",
      action: "spawn",
      type: "trader",
      name: "Package Trader",
      capital_usdt: 300,
      interval_minutes: 30,
      symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
      instructions: "Supervise validated strategy package deployments.",
    });

    expect(result).toContain("Resident agent created");
    expect(result).toContain("packages=all_allowed");
    const agent = memory.listResidentAgents({ type: "trader" })[0];
    expect(agent).toMatchObject({
      type: "trader",
      name: "Package Trader",
      status: "active",
      tradingAccountId: identity.tradingAccount.id,
      scheduleExpr: "every_30m",
    });
    expect(agent.capitalAllocationId).toBeTruthy();
    expect(memory.listAgentMandateAssignments(agent.id, { activeOnly: true })).toHaveLength(0);
  });
});
