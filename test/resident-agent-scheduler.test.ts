import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";
import { runDueResidentAgents } from "../src/agents/scheduler.js";

describe("runDueResidentAgents", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-resident-scheduler-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("advances next_run before executing a due resident agent", async () => {
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const agent = memory.createResidentAgent({
      id: "resident-1",
      type: "trader",
      name: "Due Trader",
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      scheduleExpr: "every_30m",
      nextRun: "2026-01-01T00:00:00.000Z",
    });
    const runtime = {
      nextRunFor: vi.fn().mockReturnValue("2026-01-01T00:30:00.000Z"),
      runAgent: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    };

    const result = await runDueResidentAgents({
      memory,
      runtime: runtime as any,
      now: "2026-01-01T00:00:00.000Z",
      log: vi.fn(),
    });

    expect(result).toEqual({ attempted: 1, completed: 0, failed: 1 });
    expect(memory.getResidentAgent(agent.id)?.nextRun).toBe("2026-01-01T00:30:00.000Z");
    expect(runtime.runAgent).toHaveBeenCalledWith(agent.id, "schedule");
  });
});
