import ccxt, { type Exchange } from "ccxt";
import type { MarketDataProvider } from "./types.js";

export class CcxtMarketDataProvider implements MarketDataProvider {
  private exchange: Exchange;
  readonly exchangeId: string;

  constructor(exchangeId = "binance", httpsProxy = "") {
    this.exchangeId = exchangeId;
    const ExchangeClass = (ccxt as any)[exchangeId] as new (opts: any) => Exchange;
    const opts: Record<string, any> = { enableRateLimit: true };
    if (httpsProxy) opts.httpsProxy = httpsProxy;
    this.exchange = new ExchangeClass(opts);
  }

  get ccxtInstance(): Exchange {
    return this.exchange;
  }

  async fetchTicker(symbol: string) {
    const t = await this.exchange.fetchTicker(symbol);
    return {
      symbol: t.symbol ?? symbol,
      last: Number(t.last ?? 0),
      bid: t.bid == null ? undefined : Number(t.bid),
      ask: t.ask == null ? undefined : Number(t.ask),
      high: t.high == null ? undefined : Number(t.high),
      low: t.low == null ? undefined : Number(t.low),
      volume: t.baseVolume == null ? undefined : Number(t.baseVolume),
      timestamp: Number(t.timestamp ?? Date.now()),
    };
  }

  async fetchOhlcv(symbol: string, timeframe = "1h", limit = 24) {
    const data = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    return data.map((r) => ({
      timestamp: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  }

  async fetchOrderBook(symbol: string, limit = 10) {
    const book = await this.exchange.fetchOrderBook(symbol, limit);
    return {
      bids: book.bids.slice(0, limit).map(([price, amount]) => [Number(price), Number(amount)] as [number, number]),
      asks: book.asks.slice(0, limit).map(([price, amount]) => [Number(price), Number(amount)] as [number, number]),
    };
  }

  async close(): Promise<void> {
    await this.exchange.close();
  }
}
