import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";

describe("strategy_mandate tool", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    vi.resetModules();
    dbPath = join(tmpdir(), `crypto-mandate-tool-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("creates a mandate resource with deferred validation notes", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");

    const result = await TOOL_HANDLERS.strategy_mandate({
      memory,
      sessionId: "user-session",
      action: "create",
      id: "trend_pullback_v1",
      name: "Trend Pullback",
      status: "active",
      description: "1h trend plus 15m pullback playbook",
      body: {
        style: "trend_pullback",
        universe: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
        entry: ["1h trend aligned", "15m pullback confirmed"],
      },
      validation_status: "deferred",
      validation_notes: "Full backtest approval platform is deferred.",
    });

    expect(result).toContain("Strategy mandate created");
    expect(memory.getStrategyMandate("trend_pullback_v1")).toMatchObject({
      id: "trend_pullback_v1",
      status: "active",
      validationStatus: "deferred",
      validationNotes: "Full backtest approval platform is deferred.",
      body: { style: "trend_pullback" },
      createdBy: "user-session",
    });
  });

  test("lists mandate validation state", async () => {
    await import("../src/tools/index.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    memory.createStrategyMandate({
      id: "draft_breakout_v1",
      name: "Draft Breakout",
      status: "draft",
      validationStatus: "pending",
      validationNotes: "Needs future backtest.",
    });

    const result = await TOOL_HANDLERS.strategy_mandate({ memory, action: "list" });

    expect(result).toContain("draft_breakout_v1");
    expect(result).toContain("pending");
    expect(result).toContain("draft");
  });
});
