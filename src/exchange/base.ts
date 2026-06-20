export type ExchangeMarketType = "spot" | "swap";
export type ExchangePositionSide = "long" | "short" | "net";
export type ExchangeMarginMode = "cross" | "isolated";

export interface ExchangeOrderOptions {
  marketType?: ExchangeMarketType;
  positionSide?: ExchangePositionSide;
  marginMode?: ExchangeMarginMode;
  leverage?: number;
  reduceOnly?: boolean;
}

export interface BaseExchange {
  fetchTicker(symbol: string): Promise<Record<string, any>>;
  fetchOhlcv(symbol: string, timeframe?: string, limit?: number): Promise<Record<string, any>[]>;
  fetchOrderBook(symbol: string, limit?: number): Promise<Record<string, any>>;
  createOrder(
    symbol: string,
    side: string,
    orderType: string,
    amount: number,
    price?: number | null,
    options?: ExchangeOrderOptions,
  ): Promise<Record<string, any>>;
  cancelOrder(orderId: string, symbol: string): Promise<Record<string, any>>;
  fetchBalance(): Promise<Record<string, any>>;
  fetchOpenOrders(symbol?: string | null): Promise<Record<string, any>[]>;
  fetchPositions(): Promise<Record<string, any>>;
  close(): Promise<void>;
}
