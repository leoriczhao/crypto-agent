import { computeSma, computeRsi, computeBollinger } from "./indicators.js";

export interface BacktestResult {
  strategy: string;
  symbol: string;
  timeframe: string;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  totalTrades: number;
  trades: Array<Record<string, any>>;
  equityCurve: number[];
}

interface OhlcvBar {
  close: number;
  [key: string]: any;
}

export class BacktestEngine {
  private initialCapital: number;

  constructor(initialCapital = 10000) {
    this.initialCapital = initialCapital;
  }

  run(
    ohlcv: OhlcvBar[],
    strategy: string,
    params?: Record<string, any> | null,
    symbol = "",
    timeframe = "",
  ): BacktestResult {
    const p = params ?? {};
    const strategies: Record<string, (o: OhlcvBar[], p: Record<string, any>) => [any[], number[]]> = {
      sma_crossover: (o, p) => this.runSmaCrossover(o, p),
      rsi_reversal: (o, p) => this.runRsiReversal(o, p),
      bollinger_bounce: (o, p) => this.runBollingerBounce(o, p),
    };
    if (!(strategy in strategies)) {
      throw new Error(`Unknown strategy: ${strategy}. Available: ${Object.keys(strategies).join(", ")}`);
    }
    const [trades, equity] = strategies[strategy](ohlcv, p);
    return this.buildResult(strategy, symbol, timeframe, trades, equity);
  }

  private runSmaCrossover(ohlcv: OhlcvBar[], params: Record<string, any>): [any[], number[]] {
    const shortPeriod = params.short_period ?? 10;
    const longPeriod = params.long_period ?? 30;
    const closes = ohlcv.map((b) => b.close);
    let cash = this.initialCapital;
    let position = 0;
    const trades: any[] = [];
    const equity: number[] = [];

    for (let i = longPeriod; i < closes.length; i++) {
      const price = closes[i];
      const window = closes.slice(0, i + 1);
      const shortSma = computeSma(window, shortPeriod);
      const longSma = computeSma(window, longPeriod);

      if (shortSma > longSma && position === 0) {
        const qty = cash / price;
        position = qty;
        cash = 0;
        trades.push({ side: "buy", price, quantity: qty, index: i });
      } else if (shortSma < longSma && position > 0) {
        cash = position * price;
        trades.push({ side: "sell", price, quantity: position, index: i });
        position = 0;
      }
      equity.push(cash + position * price);
    }
    this.closeOpenPosition(closes, position, cash, trades, equity);
    return [trades, equity];
  }

  private runRsiReversal(ohlcv: OhlcvBar[], params: Record<string, any>): [any[], number[]] {
    const period = params.period ?? 14;
    const oversold = params.oversold ?? 30;
    const overbought = params.overbought ?? 70;
    const closes = ohlcv.map((b) => b.close);
    let cash = this.initialCapital;
    let position = 0;
    const trades: any[] = [];
    const equity: number[] = [];

    for (let i = period + 1; i < closes.length; i++) {
      const price = closes[i];
      const window = closes.slice(0, i + 1);
      const rsi = computeRsi(window, period);

      if (rsi < oversold && position === 0) {
        const qty = cash / price;
        position = qty;
        cash = 0;
        trades.push({ side: "buy", price, quantity: qty, index: i });
      } else if (rsi > overbought && position > 0) {
        cash = position * price;
        trades.push({ side: "sell", price, quantity: position, index: i });
        position = 0;
      }
      equity.push(cash + position * price);
    }
    this.closeOpenPosition(closes, position, cash, trades, equity);
    return [trades, equity];
  }

  private runBollingerBounce(ohlcv: OhlcvBar[], params: Record<string, any>): [any[], number[]] {
    const period = params.period ?? 20;
    const stdDevParam = params.std_dev ?? 2;
    const closes = ohlcv.map((b) => b.close);
    let cash = this.initialCapital;
    let position = 0;
    const trades: any[] = [];
    const equity: number[] = [];

    for (let i = period; i < closes.length; i++) {
      const price = closes[i];
      const window = closes.slice(0, i + 1);
      const [lower, , upper] = computeBollinger(window, period, stdDevParam);

      if (price < lower && position === 0) {
        const qty = cash / price;
        position = qty;
        cash = 0;
        trades.push({ side: "buy", price, quantity: qty, index: i });
      } else if (price > upper && position > 0) {
        cash = position * price;
        trades.push({ side: "sell", price, quantity: position, index: i });
        position = 0;
      }
      equity.push(cash + position * price);
    }
    this.closeOpenPosition(closes, position, cash, trades, equity);
    return [trades, equity];
  }

  private closeOpenPosition(closes: number[], position: number, _cash: number, trades: any[], equity: number[]): void {
    if (position > 0 && closes.length) {
      const finalPrice = closes[closes.length - 1];
      const cash = position * finalPrice;
      trades.push({ side: "sell", price: finalPrice, quantity: position, index: closes.length - 1 });
      if (equity.length) equity[equity.length - 1] = cash;
    }
  }

  private buildResult(
    strategy: string,
    symbol: string,
    timeframe: string,
    trades: any[],
    equity: number[],
  ): BacktestResult {
    const totalReturn = equity.length
      ? ((equity[equity.length - 1] - this.initialCapital) / this.initialCapital) * 100
      : 0;
    return {
      strategy,
      symbol,
      timeframe,
      totalReturn,
      maxDrawdown: this.calcMaxDrawdown(equity),
      sharpeRatio: this.calcSharpe(equity),
      winRate: this.calcWinRate(trades),
      totalTrades: trades.length,
      trades,
      equityCurve: equity,
    };
  }

  private calcMaxDrawdown(equity: number[]): number {
    if (!equity.length) return 0;
    let peak = equity[0];
    let maxDd = 0;
    for (const value of equity) {
      if (value > peak) peak = value;
      const dd = ((peak - value) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
    return maxDd;
  }

  private calcSharpe(equity: number[]): number {
    if (equity.length < 2) return 0;
    const returns: number[] = [];
    for (let i = 1; i < equity.length; i++) {
      if (equity[i - 1] !== 0) returns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    }
    if (returns.length < 2) return 0;
    const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - avgRet) ** 2, 0) / (returns.length - 1);
    const stdRet = Math.sqrt(variance);
    if (stdRet === 0) return 0;
    return (avgRet / stdRet) * Math.sqrt(252);
  }

  private calcWinRate(trades: any[]): number {
    let wins = 0;
    let total = 0;
    for (let i = 0; i < trades.length - 1; i += 2) {
      if (trades[i].side === "buy" && trades[i + 1].side === "sell") {
        if (trades[i + 1].price > trades[i].price) wins++;
        total++;
      }
    }
    return total > 0 ? (wins / total) * 100 : 0;
  }
}
