/**
 * Global order mutex.
 *
 * Serializes every risk-check + order-placement critical section across the
 * whole daemon. Both the LLM-driven trade tools (slow path) and the
 * SignalEngine's OrderExecutor (fast path) acquire this lock so that:
 *
 *   1. Two concurrent chats in different sessions cannot race on the same
 *      account (Session A's `checkTradeAllowed + createOrder` fully completes
 *      before Session B starts its own).
 *
 *   2. A fast-path auto-trade cannot interleave with an in-flight LLM-issued
 *      order, and vice versa.
 *
 * The lock is global (one per daemon process) because a single exchange API
 * key addresses a single account — finer-grained locking wouldn't correctly
 * cover cross-symbol effects like total-exposure and balance checks.
 *
 * Usage:
 *   const release = await tradeLock.acquire("buy BTC/USDT");
 *   try {
 *     // fetchBalance, guard checks, createOrder, ...
 *   } finally {
 *     release();
 *   }
 *
 * Or the convenience wrapper:
 *   const result = await withTradeLock("buy BTC/USDT", async () => { ... });
 */
export class AsyncMutex {
  private waiters: Array<() => void> = [];
  private locked = false;
  private holderLabel: string | null = null;
  private holderSince: number = 0;

  /** Acquire the lock. Resolves with a release function. */
  async acquire(label = "anonymous"): Promise<() => void> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.locked = true;
    this.holderLabel = label;
    this.holderSince = Date.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holderLabel = null;
      this.holderSince = 0;
      const next = this.waiters.shift();
      if (next) {
        // Hand off: stay locked, just wake the next waiter who will set its label
        next();
      } else {
        this.locked = false;
      }
    };
  }

  /** Execute `fn` while holding the lock. Releases even if `fn` throws. */
  async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(label);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Read-only introspection for status commands / debugging. */
  get state(): { locked: boolean; holder: string | null; heldMs: number; waiters: number } {
    return {
      locked: this.locked,
      holder: this.holderLabel,
      heldMs: this.holderSince > 0 ? Date.now() - this.holderSince : 0,
      waiters: this.waiters.length,
    };
  }
}

/** Singleton trade lock for the entire daemon process. */
export const tradeLock = new AsyncMutex();

/** Convenience helper — runs `fn` under the global trade lock. */
export function withTradeLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return tradeLock.run(label, fn);
}
