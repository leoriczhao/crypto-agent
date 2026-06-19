import { describe, test, expect, vi } from "vitest";
import { hasToolCalls, type AgentAssistantMessage } from "../src/agent/provider-step.js";
import { createAgentGraphRuntime, routeAfterModel } from "../src/agent/langgraph-runtime.js";
import { registerTool, TOOL_HANDLERS } from "../src/tools/registry.js";
import type { AgentToolDeps } from "../src/agent/tool-dispatch.js";

describe("provider-step helpers", () => {
  test("detects assistant messages with tool calls", () => {
    const msg: AgentAssistantMessage = {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "tc1", function: { name: "get_price", arguments: "{}" } }],
    };

    expect(hasToolCalls(msg)).toBe(true);
  });

  test("detects final assistant messages without tool calls", () => {
    const msg: AgentAssistantMessage = { role: "assistant", content: "done" };
    expect(hasToolCalls(msg)).toBe(false);
  });
});

describe("LangGraph agent routing", () => {
  test("routes to tools when the model returned tool calls", () => {
    expect(routeAfterModel({
      messages: [{
        role: "assistant",
        content: null,
        tool_calls: [{ id: "tc1", function: { name: "get_price", arguments: "{}" } }],
      }],
      finalText: "",
    })).toBe("tools");
  });

  test("ends when the model returned final content", () => {
    expect(routeAfterModel({
      messages: [{ role: "assistant", content: "done" }],
      finalText: "done",
    })).toBe("__end__");
  });
});

describe("LangGraph agent runtime", () => {
  test("runs model, executes tool, then returns final text", async () => {
    if (!TOOL_HANDLERS.unit_echo) {
      registerTool(
        "unit_echo",
        "Echo a test value",
        {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        [],
        async ({ value }) => `echo:${value}`,
      );
    }

    async function* stream(chunks: any[]) {
      for (const chunk of chunks) yield chunk;
    }

    const client = {
      chat: {
        completions: {
          create: vi.fn()
            .mockResolvedValueOnce(stream([
              {
                choices: [{
                  delta: {
                    tool_calls: [{
                      index: 0,
                      id: "tc1",
                      function: { name: "unit_echo", arguments: "{\"value\":\"BTC\"}" },
                    }],
                  },
                }],
              },
            ]))
            .mockResolvedValueOnce(stream([
              { choices: [{ delta: { content: "done" } }] },
            ])),
        },
      },
    };
    const onToolUse = vi.fn();
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
    } satisfies AgentToolDeps;

    const result = await createAgentGraphRuntime().run({
      provider: "openai",
      client,
      messages: [{ role: "user", content: "call the echo tool" }],
      systemPrompt: "system",
      sessionId: "s1",
      callbacks: { onToolUse },
      toolDeps: deps,
    });

    expect(result.finalText).toBe("done");
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(onToolUse).toHaveBeenCalledWith("unit_echo");
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
  });
});
