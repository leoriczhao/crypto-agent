import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { Memory } from "../src/memory.js";
import { ROLES, SubAgentRunner } from "../src/sub-agents.js";
import "../src/tools/index.js";

let dbPath: string;
let memory: Memory;

beforeEach(() => {
  dbPath = join(tmpdir(), `crypto-strategist-${randomUUID().slice(0, 8)}.db`);
  memory = new Memory(dbPath);
});

afterEach(() => {
  memory.close();
  if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
});

describe("strategy_kb persistence", () => {
  test("logResearch + searchResearchKb round-trip", () => {
    const id = memory.logResearch({
      hypothesis: "BTC 1h RSI<30 long",
      symbol: "BTC/USDT",
      timeframe: "1h",
      backtestSummary: "trades=12 winrate=58% sharpe=0.4 maxdd=18%",
      outcome: "adopted",
      ruleId: "rule-xyz12345",
    });
    expect(id).toBeGreaterThan(0);

    const found = memory.searchResearchKb({ query: "RSI" });
    expect(found).toHaveLength(1);
    expect(found[0].hypothesis).toContain("RSI");
    expect(found[0].outcome).toBe("adopted");
    expect(found[0].ruleId).toBe("rule-xyz12345");
  });

  test("filter by outcome", () => {
    memory.logResearch({ hypothesis: "good one", outcome: "adopted" });
    memory.logResearch({ hypothesis: "bad one", outcome: "rejected", failureReason: "overfit" });
    memory.logResearch({ hypothesis: "maybe", outcome: "pending_review" });

    const rejected = memory.searchResearchKb({ outcome: "rejected" });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].failureReason).toBe("overfit");

    const adopted = memory.searchResearchKb({ outcome: "adopted" });
    expect(adopted).toHaveLength(1);
  });

  test("failure reasons are searchable (how future research learns)", () => {
    memory.logResearch({
      hypothesis: "ETH SMA cross",
      outcome: "rejected",
      failureReason: "too few trades in 3-month window",
    });
    const matches = memory.searchResearchKb({ query: "too few trades" });
    expect(matches).toHaveLength(1);
    expect(matches[0].hypothesis).toBe("ETH SMA cross");
  });

  test("newest entries first", () => {
    memory.logResearch({ hypothesis: "first", outcome: "rejected", failureReason: "x" });
    memory.logResearch({ hypothesis: "second", outcome: "rejected", failureReason: "x" });
    memory.logResearch({ hypothesis: "third", outcome: "rejected", failureReason: "x" });
    const list = memory.searchResearchKb({ limit: 10 });
    expect(list.map((e) => e.hypothesis)).toEqual(["third", "second", "first"]);
  });
});

describe("strategist role registration", () => {
  test("strategist role exists with kb_log + kb_search tools", () => {
    expect(ROLES.strategist).toBeDefined();
    const runner = new SubAgentRunner("strategist");
    expect(runner.allowedTools).toContain("kb_search");
    expect(runner.allowedTools).toContain("kb_log");
    expect(runner.allowedTools).toContain("backtest");
    expect(runner.allowedTools).toContain("plan_strategy");
  });

  test("strategist has higher turn budget than default", () => {
    const strategist = new SubAgentRunner("strategist");
    const researcher = new SubAgentRunner("researcher");
    expect(strategist.maxTurns).toBeGreaterThan(researcher.maxTurns);
  });

  test("strategist does NOT have buy/sell (execution belongs to fast path)", () => {
    const runner = new SubAgentRunner("strategist");
    expect(runner.allowedTools).not.toContain("buy");
    expect(runner.allowedTools).not.toContain("sell");
  });

  test("kb tool definitions are visible to the strategist role", () => {
    const runner = new SubAgentRunner("strategist");
    const defs = runner.getToolDefinitions();
    const names = defs.map((d: any) => d.name);
    expect(names).toContain("kb_log");
    expect(names).toContain("kb_search");
  });
});

describe("kb_log tool behavior", () => {
  test("rejects outcome='rejected' without failure_reason", async () => {
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const handler = TOOL_HANDLERS["kb_log"];
    expect(handler).toBeDefined();

    const out = await handler({
      memory,
      hypothesis: "x",
      outcome: "rejected",
      // no failure_reason
    });
    expect(out).toContain("failure_reason is required");
  });

  test("accepts a complete rejection with reason", async () => {
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const handler = TOOL_HANDLERS["kb_log"];
    const out = await handler({
      memory,
      hypothesis: "bad idea",
      outcome: "rejected",
      failure_reason: "sharpe 0.1 below threshold",
    });
    expect(out).toMatch(/KB entry #\d+ logged/);
    const entries = memory.searchResearchKb({});
    expect(entries).toHaveLength(1);
    expect(entries[0].failureReason).toBe("sharpe 0.1 below threshold");
  });
});
