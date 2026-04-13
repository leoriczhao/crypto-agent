import { describe, test, expect } from "vitest";
import "../src/tools/index.js";
import { ROLES, SubAgentRunner } from "../src/sub-agents.js";

describe("ROLES", () => {
  test("all roles defined", () => {
    expect("researcher" in ROLES).toBe(true);
    expect("trader" in ROLES).toBe(true);
    expect("risk_officer" in ROLES).toBe(true);
  });

  test("each role has a system prompt", () => {
    for (const [, role] of Object.entries(ROLES)) {
      expect(role.system.length).toBeGreaterThan(20);
    }
  });

  test("each role has tools", () => {
    for (const [, role] of Object.entries(ROLES)) {
      expect(role.tools.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("researcher has readonly tools", () => {
    const tools = ROLES.researcher.tools;
    expect(tools).toContain("get_price");
    expect(tools).toContain("get_news");
    expect(tools).toContain("analyze");
    expect(tools).not.toContain("buy");
    expect(tools).not.toContain("sell");
  });

  test("trader has trade tools", () => {
    const tools = ROLES.trader.tools;
    expect(tools).toContain("buy");
    expect(tools).toContain("sell");
    expect(tools).toContain("get_portfolio");
    expect(tools).toContain("analyze");
  });

  test("risk officer has risk tools", () => {
    const tools = ROLES.risk_officer.tools;
    expect(tools).toContain("assess_risk");
    expect(tools).toContain("get_portfolio");
    expect(tools).not.toContain("buy");
    expect(tools).not.toContain("sell");
  });
});

describe("SubAgentRunner", () => {
  test("filters tool definitions", () => {
    const runner = new SubAgentRunner("researcher");
    const filtered = runner.getToolDefinitions();
    const names = new Set(filtered.map((t: any) => t.name));
    expect(names.has("get_price")).toBe(true);
    expect(names.has("buy")).toBe(false);
  });

  test("unknown role throws", () => {
    expect(() => new SubAgentRunner("hacker")).toThrow(/Unknown role/);
  });

  test("system prompt contains role name", () => {
    const runner = new SubAgentRunner("trader");
    expect(runner.systemPrompt.toLowerCase()).toContain("trader");
  });

  test("get handlers filters by role", () => {
    const runner = new SubAgentRunner("risk_officer");
    const handlers = runner.getToolHandlers();
    expect("assess_risk" in handlers).toBe(true);
    expect("buy" in handlers).toBe(false);
  });
});
