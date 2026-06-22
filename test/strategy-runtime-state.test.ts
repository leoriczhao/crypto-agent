import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Memory } from "../src/memory.js";
import { StrategyRuntime } from "../src/strategy/runtime.js";
import { Strategy, type StrategyContext } from "../src/strategy/base.js";

class EmitsOnceStrategy extends Strategy {
  readonly kind = "signal";

  start(ctx: StrategyContext): void {
    ctx.emitSignal({
      ruleId: this.id,
      symbol: this.symbol,
      side: "long",
      action: "enter",
      sizeUsdt: 50,
      reason: "test signal",
      timestamp: 1700000000000,
      orderType: "limit",
      limitPrice: 49000,
    });
  }

  stop(): void {}

  requiredSubscriptions() {
    return [{ type: "ticker" as const, symbol: this.symbol }];
  }
}

describe("StrategyRuntime state persistence", () => {
  let dbPath: string;
  let memory: Memory;

  beforeEach(() => {
    dbPath = join(tmpdir(), `crypto-strategy-runtime-state-${randomUUID().slice(0, 8)}.db`);
    memory = new Memory(dbPath);
  });

  afterEach(() => {
    memory.close();
    if (existsSync(dbPath)) try { unlinkSync(dbPath); } catch {}
  });

  test("records the last emitted strategy signal", () => {
    const runtime = new StrategyRuntime({
      feed: {} as any,
      manager: { getStrategy: vi.fn(), getActiveStrategies: vi.fn().mockReturnValue([]), riskParams: {} } as any,
      memory,
    });

    runtime.startOne(new EmitsOnceStrategy({
      id: "strategy-1",
      symbol: "BTC/USDT:USDT",
      params: {},
    }));

    expect((memory as any).getStrategyRuntimeState("strategy-1")).toMatchObject({
      strategyId: "strategy-1",
      lastSignal: {
        symbol: "BTC/USDT:USDT",
        action: "enter",
        side: "long",
        sizeUsdt: 50,
        orderType: "limit",
        limitPrice: 49000,
      },
      lastError: null,
    });
  });

  test("records executor errors against the owning strategy", () => {
    const runtime = new StrategyRuntime({
      feed: {} as any,
      manager: { getStrategy: vi.fn(), getActiveStrategies: vi.fn().mockReturnValue([]), riskParams: {} } as any,
      memory,
    });
    const executor = new EventEmitter() as any;

    runtime.wireExecutor(executor);
    executor.emit("error", {
      signal: {
        ruleId: "strategy-1",
        symbol: "BTC/USDT:USDT",
        side: "long",
        action: "enter",
        sizeUsdt: 50,
        reason: "test",
        timestamp: 1700000000000,
      },
      error: "broker rejected order",
    });

    expect((memory as any).getStrategyRuntimeState("strategy-1")).toMatchObject({
      strategyId: "strategy-1",
      lastError: "broker rejected order",
    });
  });
});
