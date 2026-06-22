import type { BaseExchange } from "../exchange/base.js";
import type { Broker } from "../broker/types.js";
import type { Signal } from "./state.js";
import type { StrategyManager } from "./manager.js";
import type { Memory } from "../memory.js";
import { checkTradeAllowed } from "../trade-guard.js";

export interface RiskDecision {
  approved: boolean;
  signal: Signal;
  reason?: string;
}

/**
 * Fast-path risk gate. Delegates to the shared `checkTradeAllowed()` so both
 * the LLM-driven trade tools and the automated signal engine use identical
 * risk logic. Daily PnL and peak portfolio watermark are persisted via the
 * optional Memory dependency so they survive daemon restarts (closing the
 * "restart resets daily loss cap" loophole).
 */
export class RiskGate {
  private store: StrategyManager;
  private exchange: BaseExchange | null;
  private broker: Broker | null;
  private botId: string | null;
  private memory: Memory | null;
  private initialPortfolioValue: number;
  /** Fast-path rules are automated (no Soul context). Cap at riskParams only. */
  private readonly soulMaxPositionPct = 100;

  constructor(opts: {
    store: StrategyManager;
    initialPortfolioValue: number;
    memory?: Memory | null;
    exchange?: BaseExchange | null;
    broker?: Broker | null;
    botId?: string | null;
  }) {
    this.store = opts.store;
    this.exchange = opts.exchange ?? null;
    this.broker = opts.broker ?? null;
    this.botId = opts.botId ?? null;
    this.memory = opts.memory ?? null;
    this.initialPortfolioValue = opts.initialPortfolioValue;
  }

  async evaluate(signal: Signal): Promise<RiskDecision> {
    const today = this.todayKey();
    const dailyPnl = this.memory ? this.memory.getDailyPnl(today) : 0;

    // Peak watermark acts as the drawdown baseline. If nothing is stored yet,
    // use the configured initial balance as the floor.
    let peakValue = this.initialPortfolioValue;
    if (this.memory) {
      const wm = this.memory.getPortfolioWatermark();
      if (wm) peakValue = Math.max(peakValue, wm.peakValue);
    }

    // Budget attribution: signal.ruleId == strategy.id for fast-path signals.
    const owner = this.store.getStrategy(signal.ruleId);
    const strategyAllocatedUsdt = owner?.allocatedUsdt;
    const strategyUsedUsdt = owner ? this.store.getUsedUsdt(owner.id) : undefined;
    const ownerBotId = owner?.botId ?? this.botId ?? undefined;

    const result = await checkTradeAllowed(
      {
        exchange: this.exchange,
        broker: this.broker,
        botId: ownerBotId,
        riskParams: this.store.riskParams,
        soulMaxPositionPct: this.soulMaxPositionPct,
        maxOrderSizeUsdt: Number.POSITIVE_INFINITY, // rule-defined size; no hard cap here
        initialBalanceUsdt: peakValue,
        dailyPnl,
        strategyId: owner?.id,
        strategyAllocatedUsdt: strategyAllocatedUsdt && strategyAllocatedUsdt > 0 ? strategyAllocatedUsdt : undefined,
        strategyUsedUsdt,
      },
      signal.symbol,
      signal.action === "enter" ? "buy" : "sell",
      signal.sizeUsdt,
    );

    // Keep the peak watermark fresh while we're already querying balance/positions
    this.updatePeakFromLiveState(ownerBotId).catch(() => {});

    if (!result.allowed) {
      return { approved: false, signal, reason: result.reason };
    }
    return { approved: true, signal };
  }

  recordPnl(amount: number): void {
    if (this.memory) {
      this.memory.addDailyPnl(this.todayKey(), amount);
    }
  }

  /**
   * Query current portfolio value and lift the watermark if we've set a new high.
   * Called opportunistically after each evaluate().
   */
  async updatePeakFromLiveState(botId: string | undefined = this.botId ?? undefined): Promise<void> {
    if (!this.memory) return;
    try {
      const balance = this.broker
        ? await this.broker.fetchBalance(botId)
        : await this.exchange?.fetchBalance() ?? {};
      const positions = this.broker
        ? await this.broker.fetchPositions(botId)
        : await this.exchange?.fetchPositions() ?? {};
      const usdtFree = balance.USDT?.free ?? balance.USDT?.total ?? 0;
      let exposure = 0;
      for (const pos of Object.values(positions) as any[]) {
        exposure += Math.abs((pos.amount ?? 0) * (pos.current_price ?? pos.avg_entry_price ?? 0));
      }
      const portfolio = usdtFree + exposure;
      if (portfolio > 0) this.memory.updatePortfolioWatermark(portfolio);
    } catch {
      // ignore — next evaluate() will try again
    }
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
