import { EventEmitter } from "node:events";
import type { Strategy, StrategyContext } from "./base.js";
import type { MarketFeed } from "../market-feed.js";
import type { Memory } from "../memory.js";
import type { Signal } from "./state.js";
import type { StrategyManager } from "./manager.js";
import type { OrderExecutor } from "./executor.js";
import type { BaseExchange } from "../exchange/base.js";

/**
 * Thin orchestration layer between StrategyManager and the rest of the engine.
 *
 * Responsibilities:
 *   - Hold the live set of *started* Strategy instances.
 *   - Build a StrategyContext so each strategy can subscribe to MarketFeed
 *     and emit Signals back out of the runtime.
 *   - Re-emit all strategy signals on a single "signal" event so the daemon's
 *     wiring to OrderExecutor stays simple.
 *
 * No indicator math, no caching — that belongs to the Strategy subclass itself.
 * This class used to be SignalEngine; it's been thinned down to a coordinator.
 */
export class StrategyRuntime extends EventEmitter {
  private feed: MarketFeed;
  private manager: StrategyManager;
  private memory: Memory | null;
  private exchange: BaseExchange | null;
  private started = new Set<string>();

  constructor(opts: { feed: MarketFeed; manager: StrategyManager; memory?: Memory; exchange?: BaseExchange }) {
    super();
    this.feed = opts.feed;
    this.manager = opts.manager;
    this.memory = opts.memory ?? null;
    this.exchange = opts.exchange ?? null;
  }

  /**
   * Start all enabled strategies known to the manager. Safe to call
   * multiple times — already-started strategies are skipped.
   */
  startAll(): void {
    for (const strat of this.manager.getActiveStrategies()) {
      this.startOne(strat);
    }
  }

  startOne(strategy: Strategy): void {
    if (this.started.has(strategy.id)) return;
    const ctx: StrategyContext = {
      feed: this.feed,
      emitSignal: (signal: Signal) => this.emit("signal", signal),
      cancelOrder: async (exchangeOrderId, symbol) => {
        if (!this.exchange) return;
        try {
          await this.exchange.cancelOrder(exchangeOrderId, symbol);
        } catch (e: any) {
          this.emit("strategy_error", { strategyId: strategy.id, error: `cancelOrder: ${e.message ?? e}` });
        }
      },
      getRiskParams: () => this.manager.riskParams,
      log: this.memory ? (type, data) => this.memory!.logEvent(type, data) : undefined,
    };
    strategy.start(ctx);
    this.started.add(strategy.id);
  }

  async stopOne(id: string): Promise<void> {
    if (!this.started.has(id)) return;
    const strat = this.manager.getStrategy(id);
    if (strat) strat.stop();
    this.started.delete(id);

    // Cascade-cancel any open limit orders this strategy left on the book.
    // Without this, a disabled/removed strategy's resting orders keep sitting
    // there and will still fill (silent ghost trades).
    if (this.memory && this.exchange) {
      const open = this.memory.getOpenPendingOrdersByStrategy(id);
      for (const o of open) {
        if (!o.exchangeOrderId) continue;
        try {
          await this.exchange.cancelOrder(o.exchangeOrderId, o.symbol);
          this.memory.updatePendingOrder(o.id, { status: "cancelled" });
        } catch (e: any) {
          this.emit("strategy_error", { strategyId: id, error: `cascade-cancel ${o.exchangeOrderId}: ${e.message ?? e}` });
        }
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.started]) await this.stopOne(id);
  }

  /**
   * Subscribe to OrderExecutor lifecycle events and route them back to the
   * owning Strategy. Lets strategies that track combined state (Ladder,
   * future Grid) react to fills without poking the executor directly.
   */
  wireExecutor(executor: OrderExecutor): void {
    // Defer via setImmediate so strategy callbacks run AFTER the executor's
    // trade-lock critical section releases. Without this, a strategy that
    // emits a new signal from its onOrderFilled (grid placing a sell after a
    // buy fills) would re-enter the trade lock and deadlock against the
    // still-held fill-path lock.
    executor.on("entered", ({ signal, position }) => {
      setImmediate(() => {
        const strat = this.manager.getStrategy(signal.ruleId);
        if (!strat) return;
        try {
          strat.onOrderFilled({
            action: "enter",
            positionId: position.ruleId,
            symbol: position.symbol,
            side: position.side,
            entryPrice: position.entryPrice,
            amount: position.amount,
            timestamp: position.enteredAt,
          });
        } catch (e: any) {
          this.emit("strategy_error", { strategyId: strat.id, error: e?.message ?? String(e) });
        }
      });
    });

    executor.on("exited", ({ signal, pnl }) => {
      setImmediate(() => {
        const strat = this.manager.getStrategy(signal.ruleId);
        if (!strat) return;
        try {
          strat.onPositionClosed(pnl);
          strat.onOrderFilled({
            action: "exit",
            positionId: signal.positionId ?? signal.ruleId,
            symbol: signal.symbol,
            side: signal.side,
            pnl,
            timestamp: Date.now(),
          });
        } catch (e: any) {
          this.emit("strategy_error", { strategyId: strat.id, error: e?.message ?? String(e) });
        }
      });
    });
  }

  /** Symbols whose tickers at least one started strategy cares about. */
  get watchedSymbols(): string[] {
    const set = new Set<string>();
    for (const id of this.started) {
      const strat = this.manager.getStrategy(id);
      if (!strat) continue;
      for (const sub of strat.requiredSubscriptions()) set.add(sub.symbol);
    }
    return [...set];
  }
}
