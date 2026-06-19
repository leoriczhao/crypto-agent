import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";

describe("llm_trader_job tool and persistence", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-llm-trader-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("creates a scheduled LLM trader job bound to active bot and session", async () => {
    await import("../src/tools/llm-trader-job.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    memory.createSession("s1", "trader", "system", identity.bot.id);

    const result = await TOOL_HANDLERS.llm_trader_job({
      memory,
      sessionId: "s1",
      action: "create",
      prompt: "Every cycle, inspect BTC and ETH and decide whether to paper trade.",
      interval_minutes: 15,
    });

    expect(result).toContain("LLM trader job created");
    const jobs = memory.listLlmTraderJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      prompt: "Every cycle, inspect BTC and ETH and decide whether to paper trade.",
      enabled: true,
    });
    expect(jobs[0].sessionId).toMatch(/^llm-trader-/);
    expect(memory.getSession(jobs[0].sessionId)).toMatchObject({
      id: jobs[0].sessionId,
      type: "system",
      bot_id: identity.bot.id,
    });
    expect(memory.getLlmTraderJobBySessionId(jobs[0].sessionId)?.id).toBe(jobs[0].id);
    expect(memory.listCronJobs()[0]).toMatchObject({ id: jobs[0].cronJobId, enabled: true });
  });

  test("lists, disables, enables, and deletes trader jobs", async () => {
    await import("../src/tools/llm-trader-job.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const identity = memory.ensureDefaultIdentity({ exchangeId: "okx", mode: "PAPER", name: "default" });
    const cronJobId = memory.addCronJob("LLM trader: scalp", "every_5m", "2099-01-01T00:00:00.000Z");
    const jobId = memory.createLlmTraderJob({
      cronJobId,
      botId: identity.bot.id,
      tradingAccountId: identity.tradingAccount.id,
      sessionId: "s1",
      prompt: "scalp carefully",
    });

    const listed = await TOOL_HANDLERS.llm_trader_job({ memory, action: "list" });
    expect(listed).toContain(`#${jobId}`);
    expect(listed).toContain("scalp carefully");

    await TOOL_HANDLERS.llm_trader_job({ memory, action: "disable", id: jobId });
    expect(memory.listLlmTraderJobs()[0].enabled).toBe(false);
    expect(memory.listCronJobs()[0].enabled).toBe(false);

    await TOOL_HANDLERS.llm_trader_job({ memory, action: "enable", id: jobId });
    expect(memory.listLlmTraderJobs()[0].enabled).toBe(true);
    expect(memory.listCronJobs()[0].enabled).toBe(true);

    await TOOL_HANDLERS.llm_trader_job({ memory, action: "delete", id: jobId });
    expect(memory.listLlmTraderJobs()).toHaveLength(0);
    expect(memory.listCronJobs()).toHaveLength(0);
  });
});
