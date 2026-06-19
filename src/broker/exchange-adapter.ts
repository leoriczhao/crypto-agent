import type { BaseExchange } from "../exchange/base.js";
import type { MarketDataProvider } from "../market-data/types.js";
import type { Broker } from "./types.js";

export class BrokerExchangeAdapter implements BaseExchange {
  private marketData: MarketDataProvider;
  private broker: Broker;
  private botId: string;
  private accountId: string;

  constructor(opts: { marketData: MarketDataProvider; broker: Broker; botId: string; tradingAccountId: string }) {
    this.marketData = opts.marketData;
    this.broker = opts.broker;
    this.botId = opts.botId;
    this.accountId = opts.tradingAccountId;
  }

  get exchangeId(): string {
    return this.marketData.exchangeId;
  }

  get ccxtInstance(): unknown {
    return this.marketData.ccxtInstance;
  }

  fetchTicker(symbol: string) {
    return this.marketData.fetchTicker(symbol);
  }

  fetchOhlcv(symbol: string, timeframe = "1h", limit = 24) {
    return this.marketData.fetchOhlcv(symbol, timeframe, limit);
  }

  fetchOrderBook(symbol: string, limit = 10) {
    return this.marketData.fetchOrderBook(symbol, limit);
  }

  async createOrder(symbol: string, side: string, orderType: string, amount: number, price?: number | null) {
    if (side !== "buy" && side !== "sell") return { error: `Invalid side: ${side}` };
    if (orderType !== "market" && orderType !== "limit") return { error: `Invalid order type: ${orderType}` };
    return this.broker.createOrder({
      symbol,
      marketType: "spot",
      side,
      orderType,
      amount,
      price,
      actorType: "system",
      actorId: null,
      botId: this.botId,
      tradingAccountId: this.accountId,
    });
  }

  cancelOrder(orderId: string, symbol: string) {
    return this.broker.cancelOrder(orderId, symbol);
  }

  fetchBalance() {
    return this.broker.fetchBalance(this.botId);
  }

  fetchOpenOrders(symbol?: string | null) {
    return this.broker.fetchOpenOrders(symbol, this.botId);
  }

  fetchPositions() {
    return this.broker.fetchPositions(this.botId);
  }

  async processTick(symbol: string, last: number): Promise<void> {
    await this.broker.markToMarket(symbol, last);
  }

  async close(): Promise<void> {
    await this.marketData.close?.();
  }
}
