import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Memory } from "../src/memory.js";
import { StrategyManager } from "../src/strategy/manager.js";
import { TradeReviewer } from "../src/strategy/reviewer.js";

describe("TradeReviewer", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-reviewer-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("review prompt recommends package revisions instead of direct strategy creation", () => {
    const reviewer = new TradeReviewer(memory, new StrategyManager(memory));

    const prompt = reviewer.buildReviewPrompt();

    expect(prompt).toContain("strategy package");
    expect(prompt).toContain("deploy_strategy");
    expect(prompt).not.toContain("plan_strategy");
  });
});
