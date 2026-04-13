import { EventEmitter } from "node:events";
import type { Exchange } from "ccxt";

export interface Tick {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}

export interface Candle {
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookSnap {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
}

type TickerCb = (tick: Tick) => void;
type CandleCb = (candle: Candle) => void;
type OrderBookCb = (ob: OrderBookSnap) => void;

interface Subscription {
  type: "ticker" | "ohlcv" | "orderbook";
  symbol: string;
  timeframe?: string;
  abort: AbortController;
}

export class MarketFeed extends EventEmitter {
  private exchange: Exchange;
  private subs = new Map<string, Subscription>();
  private tickerCbs = new Map<string, Set<TickerCb>>();
  private candleCbs = new Map<string, Set<CandleCb>>();
  private orderbookCbs = new Map<string, Set<OrderBookCb>>();

  constructor(exchange: Exchange) {
    super();
    this.exchange = exchange;
  }

  subscribeTicker(symbol: string, cb: TickerCb): void {
    const key = `ticker:${symbol}`;
    if (!this.tickerCbs.has(key)) this.tickerCbs.set(key, new Set());
    this.tickerCbs.get(key)!.add(cb);
    if (!this.subs.has(key)) this.startLoop(key, "ticker", symbol);
  }

  subscribeOhlcv(symbol: string, timeframe: string, cb: CandleCb): void {
    const key = `ohlcv:${symbol}:${timeframe}`;
    if (!this.candleCbs.has(key)) this.candleCbs.set(key, new Set());
    this.candleCbs.get(key)!.add(cb);
    if (!this.subs.has(key)) this.startLoop(key, "ohlcv", symbol, timeframe);
  }

  subscribeOrderBook(symbol: string, cb: OrderBookCb): void {
    const key = `orderbook:${symbol}`;
    if (!this.orderbookCbs.has(key)) this.orderbookCbs.set(key, new Set());
    this.orderbookCbs.get(key)!.add(cb);
    if (!this.subs.has(key)) this.startLoop(key, "orderbook", symbol);
  }

  unsubscribe(symbol: string): void {
    for (const [key, sub] of this.subs.entries()) {
      if (sub.symbol === symbol) {
        sub.abort.abort();
        this.subs.delete(key);
        this.tickerCbs.delete(key);
        this.candleCbs.delete(key);
        this.orderbookCbs.delete(key);
      }
    }
  }

  async close(): Promise<void> {
    for (const sub of this.subs.values()) sub.abort.abort();
    this.subs.clear();
    this.tickerCbs.clear();
    this.candleCbs.clear();
    this.orderbookCbs.clear();
  }

  get activeSubscriptions(): string[] {
    return [...this.subs.keys()];
  }

  private startLoop(key: string, type: string, symbol: string, timeframe?: string): void {
    const ac = new AbortController();
    this.subs.set(key, { type: type as any, symbol, timeframe, abort: ac });

    const loop = async () => {
      while (!ac.signal.aborted) {
        try {
          if (type === "ticker") {
            const t = await (this.exchange as any).watchTicker(symbol);
            if (ac.signal.aborted) break;
            const tick: Tick = {
              symbol: t.symbol ?? symbol,
              last: t.last ?? 0,
              bid: t.bid ?? 0,
              ask: t.ask ?? 0,
              volume: t.baseVolume ?? 0,
              timestamp: t.timestamp ?? Date.now(),
            };
            for (const cb of this.tickerCbs.get(key) ?? []) cb(tick);
            this.emit("tick", tick);
          } else if (type === "ohlcv") {
            const candles = await (this.exchange as any).watchOHLCV(symbol, timeframe);
            if (ac.signal.aborted) break;
            const last = candles[candles.length - 1];
            if (last) {
              const candle: Candle = {
                symbol,
                timeframe: timeframe ?? "1m",
                timestamp: last[0],
                open: last[1],
                high: last[2],
                low: last[3],
                close: last[4],
                volume: last[5],
              };
              for (const cb of this.candleCbs.get(key) ?? []) cb(candle);
              this.emit("candle", candle);
            }
          } else if (type === "orderbook") {
            const book = await (this.exchange as any).watchOrderBook(symbol);
            if (ac.signal.aborted) break;
            const snap: OrderBookSnap = {
              symbol,
              bids: book.bids?.slice(0, 10) ?? [],
              asks: book.asks?.slice(0, 10) ?? [],
              timestamp: book.timestamp ?? Date.now(),
            };
            for (const cb of this.orderbookCbs.get(key) ?? []) cb(snap);
            this.emit("orderbook", snap);
          }
        } catch (err: any) {
          if (ac.signal.aborted) break;
          this.emit("error", { key, error: err.message ?? String(err) });
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    };

    loop().catch(() => {});
  }
}
