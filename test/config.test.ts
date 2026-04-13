import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));

function clearConfigEnv() {
  const keys = [
    "LLM_CONTEXT_WINDOW",
    "AUTO_COMPACT_TOKEN_THRESHOLD",
    "LLM_MAX_TOKENS",
    "SUB_AGENT_MAX_TOKENS",
    "LLM_TEMPERATURE",
    "LLM_TOP_P",
    "LLM_EXTRA_BODY_JSON",
    "ANTHROPIC_TOP_K",
    "LLM_FREQUENCY_PENALTY",
    "LLM_PRESENCE_PENALTY",
    "LLM_SEED",
    "LLM_STOP",
    "MODEL_ID",
    "ANTHROPIC_BASE_URL",
  ];
  for (const k of keys) {
    delete process.env[k];
  }
}

describe("Config", () => {
  beforeEach(() => {
    vi.resetModules();
    clearConfigEnv();
  });

  afterEach(() => {
    clearConfigEnv();
  });

  test("context window default is 500k", async () => {
    const { config } = await import("../src/config.js");
    expect(config.llmContextWindow).toBe(500_000);
  });

  test("context window reads from env", async () => {
    process.env.LLM_CONTEXT_WINDOW = "200000";
    const { config } = await import("../src/config.js");
    expect(config.llmContextWindow).toBe(200_000);
  });

  test("autoCompactTokenThreshold follows context window when unset", async () => {
    process.env.LLM_CONTEXT_WINDOW = "300000";
    const { config } = await import("../src/config.js");
    expect(config.autoCompactTokenThreshold).toBe(300_000);
  });

  test("autoCompactTokenThreshold uses explicit value", async () => {
    process.env.AUTO_COMPACT_TOKEN_THRESHOLD = "12345";
    const { config } = await import("../src/config.js");
    expect(config.autoCompactTokenThreshold).toBe(12345);
  });
});

describe("LLM Provider kwargs", () => {
  beforeEach(() => {
    vi.resetModules();
    clearConfigEnv();
  });

  afterEach(() => {
    clearConfigEnv();
  });

  test("openai omits unset sampling params", async () => {
    process.env.MODEL_ID = "test-model";
    process.env.LLM_MAX_TOKENS = "2048";
    const { config } = await import("../src/config.js");
    const { openaiChatCompletionKwargs } = await import("../src/llm/provider.js");
    const kw = openaiChatCompletionKwargs(config);
    expect(kw.model).toBe("test-model");
    expect(kw.max_tokens).toBe(2048);
    expect(kw).not.toHaveProperty("temperature");
    expect(kw).not.toHaveProperty("extra_body");
  });

  test("openai includes optional fields", async () => {
    process.env.LLM_TEMPERATURE = "0.2";
    process.env.LLM_TOP_P = "0.9";
    process.env.LLM_EXTRA_BODY_JSON = '{"foo":1}';
    const { config } = await import("../src/config.js");
    const { openaiChatCompletionKwargs } = await import("../src/llm/provider.js");
    const kw = openaiChatCompletionKwargs(config);
    expect(kw.temperature).toBe(0.2);
    expect(kw.top_p).toBe(0.9);
    expect(kw.extra_body).toEqual({ foo: 1 });
  });

  test("sub agent uses subAgentMaxTokens", async () => {
    process.env.LLM_MAX_TOKENS = "8000";
    process.env.SUB_AGENT_MAX_TOKENS = "512";
    const { config } = await import("../src/config.js");
    const { openaiChatCompletionKwargs, openaiSubAgentKwargs } = await import(
      "../src/llm/provider.js"
    );
    const main = openaiChatCompletionKwargs(config);
    const sub = openaiSubAgentKwargs(config);
    expect(main.max_tokens).toBe(8000);
    expect(sub.max_tokens).toBe(512);
  });

  test("anthropic top_k optional", async () => {
    process.env.LLM_MAX_TOKENS = "4096";
    const { config: cfg1 } = await import("../src/config.js");
    const { anthropicMessageKwargs: fn1 } = await import("../src/llm/provider.js");
    const kw1 = fn1(cfg1);
    expect(kw1).not.toHaveProperty("top_k");

    vi.resetModules();
    process.env.ANTHROPIC_TOP_K = "10";
    const { config: cfg2 } = await import("../src/config.js");
    const { anthropicMessageKwargs: fn2 } = await import("../src/llm/provider.js");
    const kw2 = fn2(cfg2);
    expect(kw2.top_k).toBe(10);
  });
});
