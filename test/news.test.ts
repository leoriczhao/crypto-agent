import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

describe("get_news tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns headlines with sentiment", async () => {
    const fakeResponse = {
      results: [
        { title: "Bitcoin surge to new high", url: "", published_at: "2024-01-01" },
        { title: "ETH rally continues", url: "", published_at: "2024-01-01" },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeResponse),
    }) as any;

    await import("../src/tools/get-news.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const result = await TOOL_HANDLERS.get_news({ symbol: "BTC" });
    const lower = result.toLowerCase();
    expect(lower).toMatch(/bitcoin|btc/);
    expect(lower).toMatch(/surge|rally/);
  });
});
