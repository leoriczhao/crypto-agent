import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

describe("get_chain_stats tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("bitcoin stats", async () => {
    const fakeStats = {
      market_price_usd: 85000.0,
      hash_rate: 700000000.0,
      n_tx: 400000,
      mempool_size: 5000,
      difficulty: 80000000000000,
      n_blocks_mined: 144,
      totalbc: 1960000000000000,
      minutes_between_blocks: 10.2,
    };
    const fakeFees = {
      fastestFee: 20,
      halfHourFee: 15,
      hourFee: 10,
      economyFee: 7,
      minimumFee: 5,
    };

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const data = callCount === 0 ? fakeStats : fakeFees;
      callCount++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    }) as any;

    await import("../src/tools/get-chain-stats.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const result = await TOOL_HANDLERS.get_chain_stats({ chain: "bitcoin" });
    expect(result).toContain("Bitcoin");
    expect(result).toContain("85,000.00");
    expect(result).toContain("sat/vB");
  });

  test("ethereum stats", async () => {
    const fakeData = {
      data: {
        market_price_usd: 3200,
        transactions_24h: 1100000,
        difficulty: 0,
        blocks_24h: 7200,
        mempool_transactions: 15000,
        average_block_time: 12.1,
        median_transaction_fee_usd_24h: 2.5,
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeData),
    }) as any;

    await import("../src/tools/get-chain-stats.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const result = await TOOL_HANDLERS.get_chain_stats({ chain: "ethereum" });
    expect(result).toContain("Ethereum");
  });

  test("api error returns error message", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as any;

    await import("../src/tools/get-chain-stats.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const result = await TOOL_HANDLERS.get_chain_stats({});
    expect(result).toContain("Error");
  });
});
