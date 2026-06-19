import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("non-compat architecture boundary", () => {
  test("paper mode has no BaseExchange adapter or in-memory PaperExchange fallback", () => {
    expect(existsSync(join(root, "src/broker/exchange-adapter.ts"))).toBe(false);
    expect(existsSync(join(root, "src/exchange/paper.ts"))).toBe(false);
    expect(existsSync(join(root, "test/broker-exchange-adapter.test.ts"))).toBe(false);
    expect(existsSync(join(root, "test/paper-exchange-limit.test.ts"))).toBe(false);

    const agent = read("src/agent.ts");
    expect(agent).not.toContain("BrokerExchangeAdapter");
    expect(agent).not.toContain("PaperExchange");
  });

  test("sqlite schema has no legacy migration or strategy_rules compatibility path", () => {
    const memory = read("src/memory.ts");
    expect(memory).not.toContain("strategy_rules");
    expect(memory).not.toContain("migrateLegacyRulesToStrategies");
    expect(memory).not.toContain("migrateAddIdentityColumns");
    expect(memory).not.toContain("backfillDefaultIdentity");
    expect(memory).not.toContain("legacy");
    expect(memory).not.toContain("backwards compat");
  });
});
