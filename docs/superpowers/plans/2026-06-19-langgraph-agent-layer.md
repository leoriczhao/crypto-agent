# LangGraph Agent Layer Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written LLM/tool loop inside `CryptoAgent` with a LangGraph state graph while preserving the existing daemon, CLI, sessions, tools, exchange, strategy, risk, and order execution behavior.

**Architecture:** LangGraph owns only the agent orchestration loop: `call_model -> execute_tools -> call_model -> END`. Existing tool registry, dependency injection, world snapshot, context compaction, session manager, exchange manager, strategy manager, and trading execution remain the source of truth. The first migration uses custom LangGraph nodes around the current OpenAI/Anthropic provider clients instead of converting the trading tools into LangChain tools, because the current registry already has JSON schemas and injected runtime dependencies.

**Tech Stack:** TypeScript ESM, `@langchain/langgraph`, existing OpenAI/Anthropic SDK clients, Vitest.

---

## Scope

This plan deliberately does **not** change:

- `src/strategy/executor.ts`
- `src/strategy/runtime.ts`
- `src/strategy/risk-gate.ts`
- `src/trade-guard.ts`
- `src/tools/buy.ts`
- `src/tools/sell.ts`
- strategy implementations under `src/strategy/*-strategy.ts`

It changes only the agent layer that currently lives mostly in `src/agent.ts`.

## Files

- Modify: `package.json`
  - Add `@langchain/langgraph`.
- Create: `src/agent/tool-dispatch.ts`
  - Own tool dependency resolution and existing `TOOL_HANDLERS` dispatch.
- Create: `src/agent/provider-step.ts`
  - Run exactly one provider turn and return either assistant content or tool calls.
- Create: `src/agent/langgraph-runtime.ts`
  - Build and run the LangGraph `StateGraph`.
- Modify: `src/agent.ts`
  - Keep exchange/session/soul initialization.
  - Delegate `chatInSession()` to the LangGraph runtime.
  - Remove old recursive provider loop after parity tests pass.
- Test: `test/agent-tool-dispatch.test.ts`
- Test: `test/langgraph-agent-runtime.test.ts`
- Test: update existing agent/session tests if needed.

## Task 1: Add LangGraph Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Install dependency**

Run:

```bash
npm install @langchain/langgraph
```

Expected: `package.json` and `package-lock.json` include `@langchain/langgraph`.

- [x] **Step 2: Verify TypeScript can import it**

Run:

```bash
node -e "import('@langchain/langgraph').then(m => console.log(Boolean(m.StateGraph)))"
```

Expected: prints `true`.

## Task 2: Extract Existing Tool Dispatch

**Files:**
- Create: `src/agent/tool-dispatch.ts`
- Modify: `src/agent.ts`
- Test: `test/agent-tool-dispatch.test.ts`

- [x] **Step 1: Write failing test**

Create `test/agent-tool-dispatch.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { dispatchAgentTool, type AgentToolDeps } from "../src/agent/tool-dispatch.js";

describe("dispatchAgentTool", () => {
  test("returns Unknown tool for missing tool name", async () => {
    const deps = {
      getExchange: () => ({}),
      getConfig: () => ({}),
      getMemory: () => null,
      getSessionId: () => "s1",
      getSoul: () => ({}),
      getExchangeManager: () => ({}),
      getAgent: () => ({}),
      getSkillLoader: () => ({}),
      getStrategyStore: () => null,
    } satisfies AgentToolDeps;

    await expect(dispatchAgentTool("missing_tool", {}, deps)).resolves.toBe("Unknown tool: missing_tool");
  });
});
```

- [x] **Step 2: Run test to verify RED**

Run:

```bash
npx vitest run test/agent-tool-dispatch.test.ts
```

Expected: FAIL because `src/agent/tool-dispatch.ts` does not exist.

- [x] **Step 3: Implement dispatch module**

Create `src/agent/tool-dispatch.ts`:

```ts
import { TOOL_DEPS, TOOL_HANDLERS } from "../tools/registry.js";
import type { config as appConfig } from "../config.js";
import type { CryptoAgent } from "../agent.js";
import type { ExchangeManager } from "../exchange/manager.js";
import type { Memory } from "../memory.js";
import type { SkillLoader } from "../skill-loader.js";
import type { StrategyManager } from "../strategy/manager.js";

export interface AgentToolDeps {
  getExchange: () => unknown;
  getConfig: () => typeof appConfig;
  getMemory: () => Memory | null;
  getSessionId: () => string;
  getSoul: () => unknown;
  getExchangeManager: () => ExchangeManager;
  getAgent: () => CryptoAgent;
  getSkillLoader: () => SkillLoader;
  getStrategyStore: () => StrategyManager | null;
}

export async function dispatchAgentTool(
  name: string,
  inputs: Record<string, unknown>,
  deps: AgentToolDeps,
): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return `Unknown tool: ${name}`;

  const depMap: Record<string, () => unknown> = {
    exchange: deps.getExchange,
    config: deps.getConfig,
    memory: deps.getMemory,
    sessionId: deps.getSessionId,
    soul: deps.getSoul,
    exchange_manager: deps.getExchangeManager,
    agent: deps.getAgent,
    skill_loader: deps.getSkillLoader,
    strategy_store: deps.getStrategyStore,
  };

  const resolved: Record<string, unknown> = {};
  for (const dep of TOOL_DEPS[name] ?? []) resolved[dep] = depMap[dep]?.();
  return handler({ ...resolved, ...inputs });
}
```

- [x] **Step 4: Update `src/agent.ts`**

Replace the private `dispatchTool()` implementation with a call to `dispatchAgentTool()` using the same dependency mapping. Do not change tool behavior.

- [x] **Step 5: Run focused test**

Run:

```bash
npx vitest run test/agent-tool-dispatch.test.ts
```

Expected: PASS.

## Task 3: Create One-Step Provider Runner

**Files:**
- Create: `src/agent/provider-step.ts`
- Modify: `src/agent.ts`
- Test: `test/langgraph-agent-runtime.test.ts`

- [x] **Step 1: Write failing tests for provider result shape**

Create the first tests in `test/langgraph-agent-runtime.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { hasToolCalls, type AgentAssistantMessage } from "../src/agent/provider-step.js";

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
```

- [x] **Step 2: Run test to verify RED**

Run:

```bash
npx vitest run test/langgraph-agent-runtime.test.ts -t "provider-step"
```

Expected: FAIL because `provider-step.ts` does not exist.

- [x] **Step 3: Implement provider result types**

Create `src/agent/provider-step.ts`:

```ts
export interface AgentToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentAssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: AgentToolCall[];
}

export interface AgentToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type AgentMessage =
  | { role: "user"; content: string }
  | AgentAssistantMessage
  | AgentToolMessage
  | { role: "system"; content: string };

export function hasToolCalls(msg: AgentAssistantMessage): boolean {
  return Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
}
```

- [x] **Step 4: Move one-turn provider logic**

Move the body of the current `streamOpenai()` and `streamAnthropic()` loops into exported one-step functions:

- `runOpenaiStep(opts)`
- `runAnthropicStep(opts)`

Each function must make exactly one model request and return one `AgentAssistantMessage`. Tool execution must not happen in these functions.

- [x] **Step 5: Run focused tests**

Run:

```bash
npx vitest run test/langgraph-agent-runtime.test.ts -t "provider-step"
```

Expected: PASS.

## Task 4: Build LangGraph Runtime

**Files:**
- Create: `src/agent/langgraph-runtime.ts`
- Modify: `src/agent.ts`
- Test: `test/langgraph-agent-runtime.test.ts`

- [x] **Step 1: Write failing graph routing tests**

Append to `test/langgraph-agent-runtime.test.ts`:

```ts
import { routeAfterModel } from "../src/agent/langgraph-runtime.js";

describe("LangGraph agent routing", () => {
  test("routes to tools when the model returned tool calls", () => {
    expect(routeAfterModel({
      messages: [{
        role: "assistant",
        content: null,
        tool_calls: [{ id: "tc1", function: { name: "get_price", arguments: "{}" } }],
      }],
    })).toBe("tools");
  });

  test("ends when the model returned final content", () => {
    expect(routeAfterModel({
      messages: [{ role: "assistant", content: "done" }],
    })).toBe("__end__");
  });
});
```

- [x] **Step 2: Run test to verify RED**

Run:

```bash
npx vitest run test/langgraph-agent-runtime.test.ts -t "LangGraph agent routing"
```

Expected: FAIL because `langgraph-runtime.ts` does not exist.

- [x] **Step 3: Implement runtime graph**

Create `src/agent/langgraph-runtime.ts` using current LangGraph.js APIs:

```ts
import { END, START, StateGraph, Annotation } from "@langchain/langgraph";
import type { ChatCallbacks } from "../agent.js";
import { dispatchAgentTool, type AgentToolDeps } from "./tool-dispatch.js";
import { hasToolCalls, type AgentAssistantMessage, type AgentMessage } from "./provider-step.js";

export const AgentState = Annotation.Root({
  messages: Annotation<AgentMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

export function routeAfterModel(state: typeof AgentState.State): "tools" | typeof END {
  const last = state.messages[state.messages.length - 1] as AgentAssistantMessage | undefined;
  return last && hasToolCalls(last) ? "tools" : END;
}
```

Then add `createAgentGraphRuntime()` with two nodes:

- `call_model`: calls `runOpenaiStep()` or `runAnthropicStep()` based on provider.
- `tools`: parses `last.tool_calls`, calls `dispatchAgentTool()`, returns tool messages.

Compile:

```ts
const graph = new StateGraph(AgentState)
  .addNode("call_model", callModel)
  .addNode("tools", executeTools)
  .addEdge(START, "call_model")
  .addConditionalEdges("call_model", routeAfterModel)
  .addEdge("tools", "call_model")
  .compile();
```

- [x] **Step 4: Preserve callback behavior**

`call_model` must call `callbacks.onDelta?.(text)` as the provider streams.  
`tools` must call `callbacks.onToolUse?.(toolName)` before each tool dispatch.

- [x] **Step 5: Run focused tests**

Run:

```bash
npx vitest run test/langgraph-agent-runtime.test.ts
```

Expected: PASS.

## Task 5: Integrate `CryptoAgent.chatInSession()`

**Files:**
- Modify: `src/agent.ts`
- Test: `test/langgraph-agent-runtime.test.ts`
- Test: existing daemon / IPC tests

- [x] **Step 1: Keep public API unchanged**

`CryptoAgent.chatInSession(sessionId, userMessage, callbacks)` must still:

- initialize provider client
- abort when `callbacks.signal` is aborted
- append user message to the in-memory session
- run `microCompact()` and `autoCompact()`
- update `session.lastActiveAt`
- include `buildFullSystemPrompt()`
- return final assistant text

- [x] **Step 2: Delegate loop to LangGraph runtime**

Replace:

```ts
if (this.provider === "openai") return this.streamOpenai(...);
return this.streamAnthropic(...);
```

with:

```ts
return this.langGraphRuntime.run({
  provider: this.provider,
  client: this.client,
  messages: session.messages,
  systemPrompt: sysPrompt,
  sessionId,
  callbacks,
  toolDeps: this.createToolDeps(sessionId),
});
```

- [x] **Step 3: Preserve session message mutation**

After the graph finishes, `session.messages` must include:

- user message
- assistant tool-call messages
- tool result messages
- final assistant message

This preserves current context behavior for later turns.

- [x] **Step 4: Remove old recursive loops**

Delete `streamOpenai()` and `streamAnthropic()` from `src/agent.ts` only after the graph path passes tests.

- [x] **Step 5: Run integration tests**

Run:

```bash
npx vitest run test/ipc-e2e.test.ts test/sub-agents.test.ts test/tools.test.ts
```

Expected: PASS.

## Task 6: Verify Behavior Parity

**Files:**
- Test only.

- [x] **Step 1: Focused agent tests**

Run:

```bash
npx vitest run test/agent-tool-dispatch.test.ts test/langgraph-agent-runtime.test.ts
```

Expected: PASS.

- [x] **Step 2: IPC and daemon-facing tests**

Run:

```bash
npx vitest run test/ipc-e2e.test.ts test/heartbeat.test.ts test/sub-agents.test.ts
```

Expected: PASS.

- [x] **Step 3: Full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [x] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

## Self-Review

- Scope is agent orchestration only.
- Trading tools remain existing registry handlers.
- Tool dependency injection remains explicit and local.
- No multi-bot scheduling.
- No SQLite checkpoint migration in this phase.
- No rewrite of strategy runtime, risk gate, executor, or exchange implementations.

## Completion Evidence

- Dependency import check: `node -e "import('@langchain/langgraph').then(m => console.log(Boolean(m.StateGraph)))"` printed `true`.
- Focused agent tests: `npx vitest run test/agent-tool-dispatch.test.ts test/langgraph-agent-runtime.test.ts` passed with 6 tests.
- IPC/tool integration tests: `npx vitest run test/ipc-e2e.test.ts test/sub-agents.test.ts test/tools.test.ts` passed with 27 tests and 1 skipped.
- Daemon-facing tests: `npx vitest run test/ipc-e2e.test.ts test/heartbeat.test.ts test/sub-agents.test.ts` passed with 21 tests.
- Full suite: `npm test` passed with 32 files, 250 tests passed, 1 skipped.
- Build: `npm run build` completed successfully.
