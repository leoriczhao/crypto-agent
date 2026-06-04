import { EventEmitter } from "node:events";
import type { BaseExchange } from "../exchange/base.js";
import type { MarketFeed, Tick } from "../market-feed.js";
import type { Memory } from "../memory.js";
import type { Signal } from "./state.js";
import type { StrategyManager } from "./manager.js";
import type { RiskGate, RiskDecision } from "./risk-gate.js";
import { withTradeLock } from "../trade-lock.js";

interface ActivePosition {
  /** Unique id for this position leg (positionId in Signal, doubles as the
   * rule_id primary key in active_positions table for backwards compat). */
  ruleId: string;
  /** Owning strategy id — lets a strategy hold multiple positions. */
  strategyId: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  amount: number;
  stopLoss: number;
  takeProfit: number;
  enteredAt: number;
}

export class OrderExecutor extends EventEmitter {
  private exchange: BaseExchange;
  private feed: MarketFeed;
  private riskGate: RiskGate;
  private store: StrategyManager;
  private memory: Memory | null;
  private positions = new Map<string, ActivePosition>();
  private paperMode: boolean;
  /** In-memory cache of signals for outstanding limit orders, keyed by
   * exchange order id. On async fill we use this to carry context that
   * pending_orders doesn't persist (e.g. takeProfitPct / stopLossPct). */
  private pendingSignals = new Map<string, { signal: Signal; amount: number }>();

  constructor(opts: {
    exchange: BaseExchange;
    feed: MarketFeed;
    riskGate: RiskGate;
    store: StrategyManager;
    memory?: Memory;
    paperMode?: boolean;
  }) {
    super();
    this.exchange = opts.exchange;
    this.feed = opts.feed;
    this.riskGate = opts.riskGate;
    this.store = opts.store;
    this.memory = opts.memory ?? null;
    this.paperMode = opts.paperMode ?? true;
  }

  start(symbols: string[]): void {
    for (const sym of symbols) {
      this.feed.subscribeTicker(sym, (tick) => this.monitorStopTakeProfit(tick));
    }
  }

  /**
   * Restore tracked positions from persistence on daemon startup.
   * Reconciles local SL/TP metadata with the exchange's actual positions:
   * - Both agree → restore fully
   * - Local record, exchange says no position → stale, drop
   * - Exchange has position, no local record → orphan, warn (caller decides)
   *
   * Returns a summary useful for logging.
   */
  async restore(): Promise<{
    restored: string[];
    staleDropped: string[];
    orphans: Array<{ key: string; value: number }>;
  }> {
    if (!this.memory) return { restored: [], staleDropped: [], orphans: [] };

    const local = this.memory.loadActivePositions();
    let exchangePositions: Record<string, any> = {};
    try {
      exchangePositions = await this.exchange.fetchPositions();
    } catch {
      // No exchange connectivity — treat everything as unknown; don't drop records.
      for (const p of local) {
        this.positions.set(p.ruleId, {
          ruleId: p.ruleId,
          strategyId: p.strategyId ?? p.ruleId,
          symbol: p.symbol,
          side: p.side,
          entryPrice: p.entryPrice,
          amount: p.amount,
          stopLoss: p.stopLoss,
          takeProfit: p.takeProfit,
          enteredAt: p.enteredAt,
        });
      }
      return { restored: local.map((p) => p.ruleId), staleDropped: [], orphans: [] };
    }

    const restored: string[] = [];
    const staleDropped: string[] = [];

    for (const p of local) {
      const exKey = `${p.symbol}:${p.side}`;
      const alt = p.symbol; // non-hedge accounts may key by symbol alone
      const ex = exchangePositions[exKey] ?? exchangePositions[alt];
      const exAmount = Math.abs(ex?.amount ?? 0);
      if (exAmount > 0) {
        this.positions.set(p.ruleId, {
          ruleId: p.ruleId,
          strategyId: p.strategyId ?? p.ruleId, // legacy rows default to ruleId
          symbol: p.symbol,
          side: p.side,
          entryPrice: p.entryPrice,
          amount: p.amount,
          stopLoss: p.stopLoss,
          takeProfit: p.takeProfit,
          enteredAt: p.enteredAt,
        });
        restored.push(p.ruleId);
      } else {
        this.memory.deleteActivePosition(p.ruleId);
        staleDropped.push(p.ruleId);
      }
    }

    // Detect orphans (exchange knows of a position the daemon never recorded)
    const knownSymbolSides = new Set(local.map((p) => `${p.symbol}:${p.side}`));
    const orphans: Array<{ key: string; value: number }> = [];
    for (const [key, pos] of Object.entries(exchangePositions) as Array<[string, any]>) {
      const amount = Math.abs(pos?.amount ?? 0);
      if (amount <= 0) continue;
      if (!knownSymbolSides.has(key) && !knownSymbolSides.has(key.split(":")[0])) {
        orphans.push({
          key,
          value: amount * (pos?.current_price ?? pos?.avg_entry_price ?? 0),
        });
      }
    }

    return { restored, staleDropped, orphans };
  }

  async handleSignal(signal: Signal): Promise<void> {
    // Fast-path shares the global trade lock with LLM-driven orders so
    // automated + human actions on the same account are fully serialized.
    await withTradeLock(`signal ${signal.action} ${signal.symbol}`, async () => {
      const decision: RiskDecision = await this.riskGate.evaluate(signal);

      if (!decision.approved) {
        this.emit("rejected", { signal, reason: decision.reason });
        this.logEvent("signal_rejected", `${signal.symbol} ${signal.action} — ${decision.reason}`);
        return;
      }

      const isLimit = signal.orderType === "limit";
      if (signal.action === "enter") {
        if (isLimit) await this.enterLimit(signal);
        else await this.enterMarket(signal);
      } else {
        if (isLimit) await this.exitLimit(signal);
        else await this.exitMarket(signal);
      }
    });
  }

  // ── Market path: immediate fill ───────────────────────────────────────────

  private async enterMarket(signal: Signal): Promise<void> {
    try {
      const ticker = await this.exchange.fetchTicker(signal.symbol);
      const price = ticker.last ?? 0;
      if (price <= 0) return;

      const amount = signal.sizeUsdt / price;
      const orderSide = signal.side === "long" ? "buy" : "sell";
      const result = await this.exchange.createOrder(signal.symbol, orderSide, "market", amount);

      if (result.error) {
        this.emit("error", { signal, error: result.error });
        return;
      }

      const execPrice = result.price ?? price;
      this.finalizeEntered(signal, execPrice, amount, result);
    } catch (err: any) {
      this.emit("error", { signal, error: err.message ?? err });
    }
  }

  private async exitMarket(signal: Signal): Promise<void> {
    const positionId = signal.positionId ?? signal.ruleId;
    const pos = this.positions.get(positionId);
    if (!pos) return;

    try {
      const orderSide = pos.side === "long" ? "sell" : "buy";
      const result = await this.exchange.createOrder(pos.symbol, orderSide, "market", pos.amount);
      if (result.error) {
        this.emit("error", { signal, error: result.error });
        return;
      }
      const exitPrice = result.price ?? (await this.exchange.fetchTicker(pos.symbol)).last ?? 0;
      this.finalizeExited(signal, pos, exitPrice, result);
    } catch (err: any) {
      this.emit("error", { signal, error: err.message ?? err });
    }
  }

  // ── Limit path: place order, wait for async fill ─────────────────────────

  private async enterLimit(signal: Signal): Promise<void> {
    if (signal.limitPrice == null || signal.limitPrice <= 0) {
      this.emit("error", { signal, error: "limit order requires a positive limitPrice" });
      return;
    }
    try {
      const amount = signal.sizeUsdt / signal.limitPrice;
      const orderSide = signal.side === "long" ? "buy" : "sell";
      const result = await this.exchange.createOrder(
        signal.symbol,
        orderSide,
        "limit",
        amount,
        signal.limitPrice,
      );
      if (result.error) {
        this.emit("error", { signal, error: result.error });
        return;
      }

      const positionId = signal.positionId ?? signal.ruleId;
      this.memory?.createPendingOrder({
        strategyId: signal.ruleId,
        positionId,
        action: "enter",
        symbol: signal.symbol,
        side: orderSide,
        orderType: "limit",
        price: signal.limitPrice,
        amount,
        exchangeOrderId: result.id,
      });
      this.pendingSignals.set(result.id, { signal, amount });
      this.emit("placed", { signal, orderId: result.id, price: signal.limitPrice, amount });
    } catch (err: any) {
      this.emit("error", { signal, error: err.message ?? err });
    }
  }

  private async exitLimit(signal: Signal): Promise<void> {
    if (signal.limitPrice == null || signal.limitPrice <= 0) {
      this.emit("error", { signal, error: "limit exit requires a positive limitPrice" });
      return;
    }
    const positionId = signal.positionId ?? signal.ruleId;
    const pos = this.positions.get(positionId);
    if (!pos) return;
    try {
      const orderSide = pos.side === "long" ? "sell" : "buy";
      const result = await this.exchange.createOrder(
        pos.symbol,
        orderSide,
        "limit",
        pos.amount,
        signal.limitPrice,
      );
      if (result.error) {
        this.emit("error", { signal, error: result.error });
        return;
      }
      this.memory?.createPendingOrder({
        strategyId: signal.ruleId,
        positionId,
        action: "exit",
        symbol: pos.symbol,
        side: orderSide,
        orderType: "limit",
        price: signal.limitPrice,
        amount: pos.amount,
        exchangeOrderId: result.id,
      });
      this.pendingSignals.set(result.id, { signal, amount: pos.amount });
      this.emit("placed", { signal, orderId: result.id, price: signal.limitPrice, amount: pos.amount });
    } catch (err: any) {
      this.emit("error", { signal, error: err.message ?? err });
    }
  }

  /**
   * Called when the exchange reports an async limit-order fill (Paper via
   * EventEmitter; Live via polling fetchOpenOrders). Looks up the original
   * signal intent from pending_orders and runs the appropriate finalize step.
   */
  async onExchangeFill(exchangeOrderId: string, execPrice: number): Promise<void> {
    const pending = this.memory?.getPendingOrderByExchangeId(exchangeOrderId);
    if (!pending) return; // not one of ours (LLM buy/sell, etc.)

    await withTradeLock(`limit-fill ${pending.symbol}`, async () => {
      // Mark the row filled first so we don't double-process.
      this.memory?.updatePendingOrder(pending.id, { status: "filled" });
      const cached = this.pendingSignals.get(exchangeOrderId);
      this.pendingSignals.delete(exchangeOrderId);

      try {
        if (pending.action === "enter") {
          // Reconstruct a signal from the persisted row if we lost it on restart.
          const signal: Signal = cached?.signal ?? {
            ruleId: pending.strategyId ?? "",
            positionId: pending.positionId ?? undefined,
            symbol: pending.symbol,
            side: pending.side === "buy" ? "long" : "short",
            action: "enter",
            sizeUsdt: (pending.price ?? execPrice) * pending.amount,
            reason: "Limit order filled (restored)",
            timestamp: Date.now(),
          };
          this.finalizeEntered(signal, execPrice, pending.amount, { id: exchangeOrderId });
        } else if (pending.action === "exit") {
          const positionId = pending.positionId ?? pending.strategyId ?? "";
          const pos = this.positions.get(positionId);
          if (!pos) return;
          const signal: Signal = cached?.signal ?? {
            ruleId: pending.strategyId ?? "",
            positionId,
            symbol: pending.symbol,
            side: pos.side,
            action: "exit",
            sizeUsdt: execPrice * pending.amount,
            reason: "Limit exit filled (restored)",
            timestamp: Date.now(),
          };
          this.finalizeExited(signal, pos, execPrice, { id: exchangeOrderId });
        }
      } catch (e: any) {
        this.emit("error", { signal: cached?.signal, error: `onExchangeFill: ${e.message ?? e}` });
      }
    });
  }

  // ── Shared post-fill bookkeeping ─────────────────────────────────────────

  private finalizeEntered(signal: Signal, execPrice: number, amount: number, result: any): void {
    const slPct = signal.stopLossPct;
    const tpPct = signal.takeProfitPct;
    const stopLoss = slPct == null ? 0
      : signal.side === "long" ? execPrice * (1 - slPct / 100) : execPrice * (1 + slPct / 100);
    const takeProfit = tpPct == null ? 0
      : signal.side === "long" ? execPrice * (1 + tpPct / 100) : execPrice * (1 - tpPct / 100);

    const positionId = signal.positionId ?? signal.ruleId;
    const pos: ActivePosition = {
      ruleId: positionId,
      strategyId: signal.ruleId,
      symbol: signal.symbol,
      side: signal.side,
      entryPrice: execPrice,
      amount,
      stopLoss,
      takeProfit,
      enteredAt: Date.now(),
    };
    this.positions.set(positionId, pos);

    this.memory?.saveActivePosition({
      ruleId: positionId,
      strategyId: signal.ruleId,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      amount: pos.amount,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      enteredAt: pos.enteredAt,
      source: "fast_path",
    });

    this.logTrade(signal, execPrice, amount, "enter");
    this.emit("entered", { signal, position: pos, result });
  }

  private finalizeExited(signal: Signal, pos: ActivePosition, exitPrice: number, result: any): void {
    const pnl = pos.side === "long"
      ? (exitPrice - pos.entryPrice) * pos.amount
      : (pos.entryPrice - exitPrice) * pos.amount;

    this.riskGate.recordPnl(pnl);
    const positionId = signal.positionId ?? signal.ruleId;
    this.positions.delete(positionId);
    this.memory?.deleteActivePosition(positionId);
    this.logTrade(signal, exitPrice, pos.amount, "exit");
    this.emit("exited", { signal, pnl, result });
  }

  private monitorStopTakeProfit(tick: Tick): void {
    for (const [positionId, pos] of this.positions.entries()) {
      if (pos.symbol !== tick.symbol) continue;

      let triggered = false;
      let reason = "";

      // Bands of 0 mean the strategy didn't compute passive SL/TP —
      // exits will come from the strategy's own signal, skip monitoring.
      const hasSl = pos.stopLoss > 0;
      const hasTp = pos.takeProfit > 0;

      if (pos.side === "long") {
        if (hasSl && tick.last <= pos.stopLoss) { triggered = true; reason = `Stop-loss hit at ${tick.last}`; }
        if (hasTp && tick.last >= pos.takeProfit) { triggered = true; reason = `Take-profit hit at ${tick.last}`; }
      } else {
        if (hasSl && tick.last >= pos.stopLoss) { triggered = true; reason = `Stop-loss hit at ${tick.last}`; }
        if (hasTp && tick.last <= pos.takeProfit) { triggered = true; reason = `Take-profit hit at ${tick.last}`; }
      }

      if (triggered) {
        const signal: Signal = {
          ruleId: pos.strategyId,
          positionId,
          symbol: pos.symbol,
          side: pos.side,
          action: "exit",
          sizeUsdt: pos.amount * tick.last,
          reason,
          timestamp: Date.now(),
        };
        // Stop-loss / take-profit exits must also go through the global lock.
        // Always use market for passive SL/TP (price has already moved past it).
        withTradeLock(`sl-tp-exit ${pos.symbol}`, () => this.exitMarket(signal))
          .catch((err) => this.emit("error", { signal, error: String(err) }));
      }
    }
  }

  private logTrade(signal: Signal, price: number, amount: number, action: string): void {
    this.memory?.logTrade("system", {
      symbol: signal.symbol,
      side: signal.side === "long" ? "buy" : "sell",
      amount,
      price,
      order_type: "market",
      mode: this.paperMode ? "PAPER" : "LIVE",
      reasoning: `[Auto] ${action}: ${signal.reason}`,
      strategyId: signal.ruleId,
    });
  }

  private logEvent(type: string, data: string): void {
    this.memory?.logEvent(type, data);
  }

  get activePositions(): ActivePosition[] {
    return [...this.positions.values()];
  }
}
