import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    microCompactEnabled: true,
    microCompactKeepRecent: 3,
    microCompactMinContentLen: 200,
    contextCharsPerToken: 4,
    autoCompactEnabled: false,
    autoCompactTokenThreshold: 500_000,
    autoCompactTranscriptDir: ".transcripts",
  },
}));

import { microCompact, estimateTokens, KEEP_RECENT } from "../src/context.js";

function makeMessages(nToolResults: number) {
  const msgs: any[] = [];
  for (let i = 0; i < nToolResults; i++) {
    msgs.push({ role: "user", content: `Question ${i}` });
    msgs.push({ role: "assistant", content: "Let me check..." });
    msgs.push({ role: "tool", tool_call_id: `tc_${i}`, content: "x".repeat(500) });
  }
  return msgs;
}

describe("microCompact", () => {
  test("keeps recent tool results", () => {
    const msgs = makeMessages(6);
    const result = microCompact(msgs);
    const toolMsgs = result.filter((m: any) => m.role === "tool");
    const compacted = toolMsgs.filter((m: any) => (m.content ?? "").includes("compacted"));
    const kept = toolMsgs.filter((m: any) => !(m.content ?? "").includes("compacted"));
    expect(compacted).toHaveLength(3);
    expect(kept).toHaveLength(KEEP_RECENT);
  });

  test("noop when few tool results", () => {
    const msgs = makeMessages(2);
    const original = msgs.filter((m: any) => m.role === "tool").map((m: any) => m.content);
    const result = microCompact(msgs);
    const after = result.filter((m: any) => m.role === "tool").map((m: any) => m.content);
    expect(original).toEqual(after);
  });

  test("skips short content", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "tc_0", content: "short" },
      { role: "tool", tool_call_id: "tc_1", content: "also short" },
      { role: "tool", tool_call_id: "tc_2", content: "x".repeat(500) },
      { role: "tool", tool_call_id: "tc_3", content: "y".repeat(500) },
      { role: "tool", tool_call_id: "tc_4", content: "z".repeat(500) },
    ];
    const result = microCompact(msgs);
    expect(result[1].content).toBe("short");
    expect(result[2].content).toBe("also short");
  });

  test("handles anthropic tool_result format", () => {
    const msgs = [
      { role: "user", content: [{ type: "tool_result", tool_use_id: "id_0", content: "x".repeat(500) }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "id_1", content: "y".repeat(500) }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "id_2", content: "z".repeat(500) }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "id_3", content: "w".repeat(500) }] },
    ];
    const result = microCompact(msgs);
    expect(result[0].content[0].content).toContain("compacted");
    expect(result[3].content[0].content).toBe("w".repeat(500));
  });
});

describe("estimateTokens", () => {
  test("returns positive integer", () => {
    const msgs = [{ role: "user", content: "hello world" }];
    const tokens = estimateTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
  });

  test("grows with content size", () => {
    const small = estimateTokens([{ role: "user", content: "hi" }]);
    const large = estimateTokens([{ role: "user", content: "x".repeat(10000) }]);
    expect(large).toBeGreaterThan(small);
  });
});
