import { EventEmitter } from "node:events";
import type { MarketDataProvider } from "./market-data/types.js";

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

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
};

const TICKER_POLL_MS = 3_000;

export class MarketFeed extends EventEmitter {
  private marketData: MarketDataProvider;
  private subs = new Map<string, Subscription>();
  private tickerCbs = new Map<string, Set<TickerCb>>();
  private candleCbs = new Map<string, Set<CandleCb>>();
  private orderbookCbs = new Map<string, Set<OrderBookCb>>();

  constructor(marketData: MarketDataProvider) {
    super();
    this.marketData = marketData;
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

  private async sleepAbortable(ms: number, ac: AbortController): Promise<void> {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      ac.signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  }

  private startLoop(key: string, type: string, symbol: string, timeframe?: string): void {
    const ac = new AbortController();
    this.subs.set(key, { type: type as any, symbol, timeframe, abort: ac });

    const tickerLoop = async () => {
      while (!ac.signal.aborted) {
        try {
          const t = await this.marketData.fetchTicker(symbol);
          if (ac.signal.aborted) break;
          const tick: Tick = {
            symbol: t.symbol ?? symbol,
            last: t.last ?? 0,
            bid: t.bid ?? 0,
            ask: t.ask ?? 0,
            volume: t.volume ?? 0,
            timestamp: t.timestamp ?? Date.now(),
          };
          for (const cb of this.tickerCbs.get(key) ?? []) cb(tick);
          this.emit("tick", tick);
          await this.sleepAbortable(TICKER_POLL_MS, ac);
        } catch (err: any) {
          if (ac.signal.aborted) break;
          this.emit("error", { key, error: err.message ?? String(err) });
          await this.sleepAbortable(5000, ac);
        }
      }
    };

    const ohlcvLoop = async () => {
      const tf = timeframe ?? "1m";
      const pollMs = Math.max(TIMEFRAME_MS[tf] ?? 60_000, 60_000);
      while (!ac.signal.aborted) {
        try {
          const candles = await this.marketData.fetchOhlcv(symbol, tf, 2);
          const last = candles[candles.length - 1];
          if (ac.signal.aborted) break;
          if (last) {
            const candle: Candle = {
              symbol,
              timeframe: tf,
              timestamp: last.timestamp,
              open: last.open,
              high: last.high,
              low: last.low,
              close: last.close,
              volume: last.volume,
            };
            for (const cb of this.candleCbs.get(key) ?? []) cb(candle);
            this.emit("candle", candle);
          }
          await this.sleepAbortable(pollMs, ac);
        } catch (err: any) {
          if (ac.signal.aborted) break;
          this.emit("error", { key, error: err.message ?? String(err) });
          await this.sleepAbortable(5000, ac);
        }
      }
    };

    const orderbookLoop = async () => {
      while (!ac.signal.aborted) {
        try {
          const book = await this.marketData.fetchOrderBook(symbol, 10);
          if (ac.signal.aborted) break;
          const snap: OrderBookSnap = {
            symbol,
            bids: book.bids?.slice(0, 10) ?? [],
            asks: book.asks?.slice(0, 10) ?? [],
            timestamp: Date.now(),
          };
          for (const cb of this.orderbookCbs.get(key) ?? []) cb(snap);
          this.emit("orderbook", snap);
          await this.sleepAbortable(TICKER_POLL_MS, ac);
        } catch (err: any) {
          if (ac.signal.aborted) break;
          this.emit("error", { key, error: err.message ?? String(err) });
          await this.sleepAbortable(5000, ac);
        }
      }
    };

    const loop =
      type === "ticker" ? tickerLoop
      : type === "ohlcv" ? ohlcvLoop
      : orderbookLoop;
    loop().catch(() => {});
  }
}
