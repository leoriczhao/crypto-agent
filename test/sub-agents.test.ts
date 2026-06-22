import { describe, test, expect } from "vitest";
import "../src/tools/index.js";
import { ROLES, SubAgentRunner, runSubAgent } from "../src/sub-agents.js";
import { TOOL_DEFINITIONS } from "../src/tools/registry.js";
import { Memory } from "../src/memory.js";

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

  test("delegate describes package-first strategist workflow", () => {
    const delegate = TOOL_DEFINITIONS.find((tool) => tool.name === "delegate");
    expect(delegate?.description).toContain("strategy package");
    expect(delegate?.description).not.toContain("commit rule");
  });

  test("strategist sub-agent injects market data into validate_strategy", async () => {
    const memory = new Memory(":memory:");
    memory.createStrategyPackage({
      id: "btc_signal",
      version: 1,
      familyId: "btc_signal",
      name: "BTC Signal",
      status: "submitted",
      source: "researcher",
      mandate: "Validate a signal package.",
      executableSpec: {
        kind: "signal",
        symbols: ["BTC/USDT:USDT"],
        timeframe: "1h",
        side: "long",
        entry: [{ indicator: "price_level", operator: "gt", value: 100 }],
        exit: [{ indicator: "price_level", operator: "gt", value: 105 }],
        positionSizeUsdt: 50,
        stopLossPct: 3,
        takeProfitPct: 5,
      },
      riskPolicy: { maxLeverage: 3, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 300 },
    });
    const closes: number[] = [];
    for (let i = 0; i < 60; i++) closes.push(99, 101, 107, 95);
    const marketData = {
      fetchOhlcv: async () => closes.map((close, i) => ({
        timestamp: i * 3600000,
        open: close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume: 1000,
      })),
    };
    let calls = 0;
    const agent = {
      provider: "openai",
      memory,
      marketData,
      client: {
        chat: {
          completions: {
            create: async ({ messages }: any) => {
              calls++;
              if (calls === 1) {
                return {
                  choices: [{
                    finish_reason: "tool_calls",
                    message: {
                      content: null,
                      tool_calls: [{
                        id: "call-1",
                        type: "function",
                        function: {
                          name: "validate_strategy",
                          arguments: JSON.stringify({
                            action: "run",
                            package_id: "btc_signal",
                            package_version: 1,
                          }),
                        },
                      }],
                    },
                  }],
                  usage: {},
                };
              }
              const toolMessage = messages.findLast((m: any) => m.role === "tool");
              return {
                choices: [{
                  finish_reason: "stop",
                  message: { content: toolMessage.content },
                }],
                usage: {},
              };
            },
          },
        },
      },
    } as any;

    try {
      const result = await runSubAgent(agent, "session-1", "strategist", "validate btc_signal");

      expect(result).toContain("validation=passed");
    } finally {
      memory.close();
    }
  });
});
