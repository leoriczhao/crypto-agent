import { describe, test, expect } from "vitest";
import { AsyncMutex, withTradeLock, tradeLock } from "../src/trade-lock.js";

describe("AsyncMutex", () => {
  test("serializes concurrent acquires", async () => {
    const mutex = new AsyncMutex();
    const log: string[] = [];

    const work = (label: string, ms: number) => mutex.run(label, async () => {
      log.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${label}:end`);
    });

    await Promise.all([work("A", 20), work("B", 10), work("C", 5)]);

    // Each operation must fully complete before the next one starts
    expect(log).toEqual([
      "A:start", "A:end",
      "B:start", "B:end",
      "C:start", "C:end",
    ]);
  });

  test("releases on error in run()", async () => {
    const mutex = new AsyncMutex();
    await expect(mutex.run("failing", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // Lock should be free; next acquire must succeed immediately
    expect(mutex.state.locked).toBe(false);
    await mutex.run("recovery", async () => { /* no-op */ });
    expect(mutex.state.locked).toBe(false);
  });

  test("acquire() returns a release function usable via try/finally", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire("manual");
    expect(mutex.state.locked).toBe(true);
    expect(mutex.state.holder).toBe("manual");
    release();
    expect(mutex.state.locked).toBe(false);
  });

  test("double-release is a no-op (idempotent)", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire("x");
    release();
    release(); // second call should not error or break the next acquire
    const r2 = await mutex.acquire("y");
    expect(mutex.state.locked).toBe(true);
    r2();
  });

  test("state.heldMs advances while locked", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire("held");
    await new Promise((r) => setTimeout(r, 15));
    expect(mutex.state.heldMs).toBeGreaterThanOrEqual(10);
    release();
    expect(mutex.state.heldMs).toBe(0);
  });

  test("waiters count reflects queued tasks", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire("head");
    const p1 = mutex.run("q1", async () => {});
    const p2 = mutex.run("q2", async () => {});
    // Give the event loop a tick so both p1 and p2 are queued
    await new Promise((r) => setImmediate(r));
    expect(mutex.state.waiters).toBe(2);
    release();
    await Promise.all([p1, p2]);
    expect(mutex.state.waiters).toBe(0);
    expect(mutex.state.locked).toBe(false);
  });
});

describe("withTradeLock (global singleton)", () => {
  test("serializes two concurrent trade-like operations", async () => {
    const order: string[] = [];

    const simulateTrade = (label: string) => withTradeLock(label, async () => {
      order.push(`${label}:fetch`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`${label}:check`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`${label}:place`);
    });

    await Promise.all([simulateTrade("T1"), simulateTrade("T2")]);

    // T1's check+place must not interleave with T2's fetch
    const t1End = order.indexOf("T1:place");
    const t2Start = order.indexOf("T2:fetch");
    expect(t1End).toBeLessThan(t2Start);
    expect(tradeLock.state.locked).toBe(false);
  });

  test("exceptions release the global lock", async () => {
    await expect(withTradeLock("fail", async () => { throw new Error("rejected"); })).rejects.toThrow("rejected");
    expect(tradeLock.state.locked).toBe(false);
    // next one should acquire immediately
    let ran = false;
    await withTradeLock("recover", async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
