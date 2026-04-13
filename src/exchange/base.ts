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
  ): Promise<Record<string, any>>;
  cancelOrder(orderId: string, symbol: string): Promise<Record<string, any>>;
  fetchBalance(): Promise<Record<string, any>>;
  fetchOpenOrders(symbol?: string | null): Promise<Record<string, any>[]>;
  fetchPositions(): Promise<Record<string, any>>;
  close(): Promise<void>;
}
