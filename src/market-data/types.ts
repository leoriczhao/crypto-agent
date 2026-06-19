export interface MarketTicker {
  symbol: string;
  last: number;
  bid?: number;
  ask?: number;
  high?: number;
  low?: number;
  volume?: number;
  timestamp: number;
}

export interface MarketCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketOrderBook {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

export interface MarketDataProvider {
  readonly exchangeId: string;
  fetchTicker(symbol: string): Promise<MarketTicker>;
  fetchOhlcv(symbol: string, timeframe?: string, limit?: number): Promise<MarketCandle[]>;
  fetchOrderBook(symbol: string, limit?: number): Promise<MarketOrderBook>;
  close?(): Promise<void>;
}
