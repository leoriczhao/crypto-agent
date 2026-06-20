import ccxt, { type Exchange } from "ccxt";
import type { BaseExchange, ExchangeOrderOptions } from "./base.js";

export class LiveExchange implements BaseExchange {
  private exchange: Exchange;
  readonly exchangeId: string;

  constructor(exchangeId = "binance", apiKey = "", secret = "", password = "", httpsProxy = "") {
    this.exchangeId = exchangeId;
    const ExchangeClass = (ccxt as any)[exchangeId] as new (opts: any) => Exchange;
    const opts: Record<string, any> = { apiKey, secret, enableRateLimit: true };
    if (password) opts.password = password;
    if (httpsProxy) opts.httpsProxy = httpsProxy;
    this.exchange = new ExchangeClass(opts);
  }

  async fetchTicker(symbol: string) {
    const t = await this.exchange.fetchTicker(symbol);
    return {
      symbol: t.symbol,
      last: t.last,
      bid: t.bid,
      ask: t.ask,
      high: t.high,
      low: t.low,
      volume: t.baseVolume,
      change_percent: t.percentage ?? 0,
    };
  }

  async fetchOhlcv(symbol: string, timeframe = "1h", limit = 24) {
    const data = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    return data.map((r) => ({
      timestamp: r[0],
      open: r[1],
      high: r[2],
      low: r[3],
      close: r[4],
      volume: r[5],
    }));
  }

  async fetchOrderBook(symbol: string, limit = 10) {
    const book = await this.exchange.fetchOrderBook(symbol, limit);
    return { bids: book.bids.slice(0, limit), asks: book.asks.slice(0, limit) };
  }

  async createOrder(
    symbol: string,
    side: string,
    orderType: string,
    amount: number,
    price?: number | null,
    options?: ExchangeOrderOptions,
  ) {
    const exchangeAmount = await this.toExchangeOrderAmount(symbol, amount, options);
    if (options?.marketType === "swap" && options.leverage !== undefined) {
      await this.setContractLeverage(symbol, options.leverage, {
        marginMode: options.marginMode ?? "isolated",
        positionSide: options.positionSide ?? "net",
      });
    }
    const o = await this.exchange.createOrder(
      symbol,
      orderType,
      side,
      exchangeAmount,
      price ?? undefined,
      this.createOrderParams(options),
    );
    return {
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      amount: o.amount,
      price: o.price,
      status: o.status,
    };
  }

  async cancelOrder(orderId: string, symbol: string) {
    const r = await this.exchange.cancelOrder(orderId, symbol);
    return { id: r.id, status: "canceled" };
  }

  async fetchBalance() {
    const bal: Record<string, any> = await this.exchange.fetchBalance();
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(bal)) {
      if (typeof v === "object" && v !== null && "total" in v && (v as any).total > 0) {
        result[k] = v;
      }
    }
    return result;
  }

  async fetchOpenOrders(symbol?: string | null) {
    const orders = await this.exchange.fetchOpenOrders(symbol ?? undefined);
    return orders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      amount: o.amount,
      price: o.price,
    }));
  }

  async fetchPositions() {
    try {
      const positions = await this.exchange.fetchPositions();
      const result: Record<string, any> = {};
      for (const p of positions) {
        const contracts = parseFloat(String((p as any).contracts ?? 0));
        if (contracts === 0) continue;
        const symbol = p.symbol ?? "";
        const side = p.side ?? "long";
        const hedged = (p as any).hedged ?? false;
        const key = hedged ? `${symbol}:${side}` : symbol;
        const entry = parseFloat(String(p.entryPrice ?? 0));
        const mark = parseFloat(String(p.markPrice ?? 0)) || parseFloat(String((p as any).lastPrice ?? 0));
        const contractSize = this.positionContractSize(p, symbol);
        const amount = contractSize > 0 ? contracts * contractSize : contracts;
        const pnl = parseFloat(String(p.unrealizedPnl ?? 0));
        result[key] = {
          symbol,
          side,
          contracts,
          amount,
          avg_entry_price: entry,
          current_price: mark,
          unrealized_pnl: Math.round(pnl * 100) / 100,
          leverage: p.leverage,
          margin_mode: p.marginMode,
          hedged,
        };
      }
      return result;
    } catch {
      return {};
    }
  }

  async close() {
    await this.exchange.close();
  }

  private createOrderParams(options?: ExchangeOrderOptions): Record<string, any> {
    if (!options) return {};
    const params: Record<string, any> = {};
    if (options.marketType === "swap" || options.marginMode) {
      params.marginMode = options.marginMode ?? "isolated";
    }
    if (options.positionSide) {
      params.positionSide = options.positionSide;
    }
    if (options.reduceOnly) {
      params.reduceOnly = true;
    }
    return params;
  }

  private async setContractLeverage(
    symbol: string,
    leverage: number,
    opts: { marginMode: "cross" | "isolated"; positionSide?: "long" | "short" | "net" },
  ): Promise<void> {
    const setLeverage = (this.exchange as any).setLeverage;
    if (typeof setLeverage !== "function") {
      throw new Error(`${this.exchangeId} does not support setting leverage through ccxt`);
    }
    const params: Record<string, any> = { marginMode: opts.marginMode };
    if (opts.positionSide) params.posSide = opts.positionSide;
    await setLeverage.call(this.exchange, leverage, symbol, params);
  }

  private async toExchangeOrderAmount(
    symbol: string,
    amount: number,
    options?: ExchangeOrderOptions,
  ): Promise<number> {
    if (options?.marketType !== "swap") return amount;
    const contractSize = await this.marketContractSize(symbol);
    return contractSize > 0 ? amount / contractSize : amount;
  }

  private async marketContractSize(symbol: string): Promise<number> {
    const ex = this.exchange as any;
    if (typeof ex.loadMarkets === "function") await ex.loadMarkets();
    const market = typeof ex.market === "function" ? ex.market(symbol) : null;
    return Number(market?.contractSize ?? 0);
  }

  private positionContractSize(position: Record<string, any>, symbol: string): number {
    const direct = Number(position.contractSize ?? 0);
    if (direct > 0) return direct;
    try {
      const market = (this.exchange as any).market?.(symbol);
      return Number(market?.contractSize ?? 0);
    } catch {
      return 0;
    }
  }
}
