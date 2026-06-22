import { describe, test, expect } from "vitest";
import { dispatchAgentTool, type AgentToolDeps } from "../src/agent/tool-dispatch.js";

describe("dispatchAgentTool", () => {
  test("returns Unknown tool for missing tool name", async () => {
    const deps = {
      getExchange: () => ({}),
      getConfig: () => ({} as any),
      getMemory: () => null,
      getSessionId: () => "s1",
      getSoul: () => ({}),
      getExchangeManager: () => ({} as any),
      getAgent: () => ({} as any),
      getSkillLoader: () => ({} as any),
      getStrategyStore: () => null,
      getStrategyDeploymentService: () => null,
    } satisfies AgentToolDeps;

    await expect(dispatchAgentTool("missing_tool", {}, deps)).resolves.toBe("Unknown tool: missing_tool");
  });
});
