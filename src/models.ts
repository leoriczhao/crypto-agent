export enum Side {
  BUY = "buy",
  SELL = "sell",
}

export enum OrderType {
  MARKET = "market",
  LIMIT = "limit",
}

export enum OrderStatus {
  OPEN = "open",
  FILLED = "filled",
  CANCELED = "canceled",
  FAILED = "failed",
}

export class Order {
  id: string;
  symbol: string;
  side: Side;
  orderType: OrderType;
  amount: number;
  price: number | null;
  status: OrderStatus;
  filledPrice: number | null;
  createdAt: Date;

  constructor(params: {
    id: string;
    symbol: string;
    side: Side;
    orderType: OrderType;
    amount: number;
    price?: number | null;
    status?: OrderStatus;
    filledPrice?: number | null;
    createdAt?: Date;
  }) {
    this.id = params.id;
    this.symbol = params.symbol;
    this.side = params.side;
    this.orderType = params.orderType;
    this.amount = params.amount;
    this.price = params.price ?? null;
    this.status = params.status ?? OrderStatus.OPEN;
    this.filledPrice = params.filledPrice ?? null;
    this.createdAt = params.createdAt ?? new Date();
  }

  toDict() {
    return {
      id: this.id,
      symbol: this.symbol,
      side: this.side,
      type: this.orderType,
      amount: this.amount,
      price: this.price,
      filled_price: this.filledPrice,
      status: this.status,
      created_at: this.createdAt.toISOString(),
    };
  }
}

export class Position {
  symbol: string;
  amount: number;
  avgEntryPrice: number;
  currentPrice: number;

  constructor(params: {
    symbol: string;
    amount: number;
    avgEntryPrice: number;
    currentPrice?: number;
  }) {
    this.symbol = params.symbol;
    this.amount = params.amount;
    this.avgEntryPrice = params.avgEntryPrice;
    this.currentPrice = params.currentPrice ?? 0;
  }

  get unrealizedPnl(): number {
    return (this.currentPrice - this.avgEntryPrice) * this.amount;
  }

  get pnlPercent(): number {
    if (this.avgEntryPrice === 0) return 0;
    return ((this.currentPrice - this.avgEntryPrice) / this.avgEntryPrice) * 100;
  }

  toDict() {
    return {
      symbol: this.symbol,
      amount: this.amount,
      avg_entry_price: this.avgEntryPrice,
      current_price: this.currentPrice,
      unrealized_pnl: Math.round(this.unrealizedPnl * 100) / 100,
      pnl_percent: `${this.pnlPercent.toFixed(2)}%`,
    };
  }
}
