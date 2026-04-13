import { EventEmitter } from "node:events";
import type { BaseExchange } from "../exchange/base.js";
import type { MarketFeed, Tick } from "../market-feed.js";
import type { Memory } from "../memory.js";
import type { Signal, StrategyStore } from "./state.js";
import type { RiskGate, RiskDecision } from "./risk-gate.js";

interface ActivePosition {
  ruleId: string;
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
  private store: StrategyStore;
  private memory: Memory | null;
  private positions = new Map<string, ActivePosition>();
  private paperMode: boolean;

  constructor(opts: {
    exchange: BaseExchange;
    feed: MarketFeed;
    riskGate: RiskGate;
    store: StrategyStore;
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

  async handleSignal(signal: Signal): Promise<void> {
    const decision: RiskDecision = await this.riskGate.evaluate(signal);

    if (!decision.approved) {
      this.emit("rejected", { signal, reason: decision.reason });
      this.logEvent("signal_rejected", `${signal.symbol} ${signal.action} — ${decision.reason}`);
      return;
    }

    if (signal.action === "enter") {
      await this.enter(signal);
    } else {
      await this.exit(signal);
    }
  }

  private async enter(signal: Signal): Promise<void> {
    const rule = this.store.getRule(signal.ruleId);
    if (!rule) return;

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
      const stopLoss = signal.side === "long"
        ? execPrice * (1 - rule.stopLossPct / 100)
        : execPrice * (1 + rule.stopLossPct / 100);
      const takeProfit = signal.side === "long"
        ? execPrice * (1 + rule.takeProfitPct / 100)
        : execPrice * (1 - rule.takeProfitPct / 100);

      const pos: ActivePosition = {
        ruleId: rule.id,
        symbol: signal.symbol,
        side: signal.side,
        entryPrice: execPrice,
        amount,
        stopLoss,
        takeProfit,
        enteredAt: Date.now(),
      };
      this.positions.set(signal.ruleId, pos);

      this.logTrade(signal, execPrice, amount, "enter");
      this.emit("entered", { signal, position: pos, result });
    } catch (err: any) {
      this.emit("error", { signal, error: err.message ?? err });
    }
  }

  private async exit(signal: Signal): Promise<void> {
    const pos = this.positions.get(signal.ruleId);
    if (!pos) return;

    try {
      const orderSide = pos.side === "long" ? "sell" : "buy";
      const result = await this.exchange.createOrder(pos.symbol, orderSide, "market", pos.amount);

      if (result.error) {
        this.emit("error", { signal, error: result.error });
        return;
      }

      const exitPrice = result.price ?? (await this.exchange.fetchTicker(pos.symbol)).last ?? 0;
      const pnl = pos.side === "long"
        ? (exitPrice - pos.entryPrice) * pos.amount
        : (pos.entryPrice - exitPrice) * pos.amount;

      this.riskGate.recordPnl(pnl);
      this.positions.delete(signal.ruleId);
      this.logTrade(signal, exitPrice, pos.amount, "exit");
      this.emit("exited", { signal, pnl, result });
    } catch (err: any) {
      this.emit("error", { signal, error: err.message ?? err });
    }
  }

  private monitorStopTakeProfit(tick: Tick): void {
    for (const [ruleId, pos] of this.positions.entries()) {
      if (pos.symbol !== tick.symbol) continue;

      let triggered = false;
      let reason = "";

      if (pos.side === "long") {
        if (tick.last <= pos.stopLoss) { triggered = true; reason = `Stop-loss hit at ${tick.last}`; }
        if (tick.last >= pos.takeProfit) { triggered = true; reason = `Take-profit hit at ${tick.last}`; }
      } else {
        if (tick.last >= pos.stopLoss) { triggered = true; reason = `Stop-loss hit at ${tick.last}`; }
        if (tick.last <= pos.takeProfit) { triggered = true; reason = `Take-profit hit at ${tick.last}`; }
      }

      if (triggered) {
        const signal: Signal = {
          ruleId,
          symbol: pos.symbol,
          side: pos.side,
          action: "exit",
          sizeUsdt: pos.amount * tick.last,
          reason,
          timestamp: Date.now(),
        };
        this.exit(signal).catch((err) => this.emit("error", { signal, error: String(err) }));
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
    });
  }

  private logEvent(type: string, data: string): void {
    this.memory?.logEvent(type, data);
  }

  get activePositions(): ActivePosition[] {
    return [...this.positions.values()];
  }
}
