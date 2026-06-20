import { describe, expect, test } from "vitest";
import { injectEphemeralCurrentState } from "../src/agent/ephemeral-current-state.js";
import type { AgentMessage } from "../src/agent/provider-step.js";

describe("injectEphemeralCurrentState", () => {
  test("adds current state to the latest user message without persisting it", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "trade carefully" },
    ];

    const injected = injectEphemeralCurrentState(messages, "Mode: PAPER\nPositions: none");

    expect(injected.messages).not.toBe(messages);
    expect(injected.messages[0].content).toContain("trade carefully");
    expect(injected.messages[0].content).toContain("## Current State");
    expect(messages[0].content).toBe("trade carefully");

    const restored = injected.restore([
      ...injected.messages,
      { role: "assistant", content: "done" },
    ]);

    expect(restored).toEqual([
      { role: "user", content: "trade carefully" },
      { role: "assistant", content: "done" },
    ]);
  });

  test("does nothing when there is no snapshot", () => {
    const messages: AgentMessage[] = [{ role: "user", content: "hello" }];
    const injected = injectEphemeralCurrentState(messages, "");

    expect(injected.messages).toBe(messages);
    expect(injected.restore(messages)).toBe(messages);
  });
});
