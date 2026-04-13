import type { BaseExchange } from "../exchange/base.js";
import type { Signal, StrategyStore } from "./state.js";

export interface RiskDecision {
  approved: boolean;
  signal: Signal;
  reason?: string;
}

export class RiskGate {
  private store: StrategyStore;
  private exchange: BaseExchange;
  private dailyPnl = 0;
  private dailyResetDate = "";
  private initialPortfolioValue: number;

  constructor(store: StrategyStore, exchange: BaseExchange, initialPortfolioValue: number) {
    this.store = store;
    this.exchange = exchange;
    this.initialPortfolioValue = initialPortfolioValue;
  }

  async evaluate(signal: Signal): Promise<RiskDecision> {
    const params = this.store.riskParams;
    this.resetDailyIfNeeded();

    try {
      const balance = await this.exchange.fetchBalance();
      const positions = await this.exchange.fetchPositions();

      const usdtFree = balance.USDT?.total ?? balance.USDT?.free ?? 0;
      let totalExposure = 0;
      let positionCount = 0;

      for (const pos of Object.values(positions) as any[]) {
        const value = Math.abs((pos.amount ?? 0) * (pos.current_price ?? pos.avg_entry_price ?? 0));
        if (value > 0) {
          totalExposure += value;
          positionCount++;
        }
      }

      const portfolioValue = usdtFree + totalExposure;

      if (signal.action === "enter") {
        const newPositionPct = portfolioValue > 0 ? (signal.sizeUsdt / portfolioValue) * 100 : 100;
        if (newPositionPct > params.maxPositionPct) {
          return this.reject(signal, `Position size ${newPositionPct.toFixed(1)}% exceeds max ${params.maxPositionPct}%`);
        }

        const newExposurePct = portfolioValue > 0
          ? ((totalExposure + signal.sizeUsdt) / portfolioValue) * 100
          : 100;
        if (newExposurePct > params.maxExposurePct) {
          return this.reject(signal, `Exposure would be ${newExposurePct.toFixed(1)}%, exceeds max ${params.maxExposurePct}%`);
        }

        if (positionCount >= params.maxConcurrentPositions) {
          return this.reject(signal, `Already ${positionCount} positions, max is ${params.maxConcurrentPositions}`);
        }

        if (signal.sizeUsdt > usdtFree) {
          return this.reject(signal, `Insufficient balance: need $${signal.sizeUsdt.toFixed(2)}, have $${usdtFree.toFixed(2)}`);
        }
      }

      const drawdownPct = this.initialPortfolioValue > 0
        ? ((this.initialPortfolioValue - portfolioValue) / this.initialPortfolioValue) * 100
        : 0;
      if (drawdownPct > params.maxDrawdownPct) {
        return this.reject(signal, `Drawdown ${drawdownPct.toFixed(1)}% exceeds max ${params.maxDrawdownPct}% — emergency`);
      }

      if (Math.abs(this.dailyPnl) > 0) {
        const dailyLossPct = this.initialPortfolioValue > 0
          ? (Math.abs(Math.min(0, this.dailyPnl)) / this.initialPortfolioValue) * 100
          : 0;
        if (dailyLossPct > params.maxDailyLossPct) {
          return this.reject(signal, `Daily loss ${dailyLossPct.toFixed(1)}% exceeds max ${params.maxDailyLossPct}%`);
        }
      }

      return { approved: true, signal };
    } catch (err: any) {
      return this.reject(signal, `Risk check error: ${err.message ?? err}`);
    }
  }

  recordPnl(amount: number): void {
    this.resetDailyIfNeeded();
    this.dailyPnl += amount;
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyResetDate !== today) {
      this.dailyPnl = 0;
      this.dailyResetDate = today;
    }
  }

  private reject(signal: Signal, reason: string): RiskDecision {
    return { approved: false, signal, reason };
  }
}
