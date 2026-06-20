import type { MarketType } from "./symbols.js";

export type BrokerMode = "PAPER" | "LIVE";
export type BrokerSide = "buy" | "sell";
export type BrokerOrderType = "market" | "limit";
export type BrokerOrderStatus = "open" | "filled" | "cancelled" | "rejected" | "unknown";
export type BrokerPositionSide = "long" | "short";
export type BrokerActorType = "session" | "strategy" | "resident_agent" | "system";

export interface BrokerOrderRequest {
  symbol: string;
  marketType: MarketType;
  side: BrokerSide;
  positionSide?: BrokerPositionSide;
  orderType: BrokerOrderType;
  amount: number;
  price?: number | null;
  notionalUsdt?: number;
  leverage?: number;
  reduceOnly?: boolean;
  actorType: BrokerActorType;
  actorId?: string | null;
  agentRunId?: string | null;
  mandateId?: string | null;
  capitalAllocationId?: string | null;
  botId: string;
  tradingAccountId: string;
}

export interface BrokerOrderResult {
  id: string;
  symbol: string;
  marketType: MarketType;
  side: BrokerSide;
  positionSide?: BrokerPositionSide | null;
  type: BrokerOrderType;
  amount: number;
  price: number | null;
  leverage?: number | null;
  reduceOnly?: boolean;
  status: BrokerOrderStatus;
  error?: string;
  created_at?: string;
  filled_at?: string | null;
}

export interface BrokerPosition {
  symbol: string;
  marketType: MarketType;
  side: BrokerPositionSide;
  amount: number;
  contracts?: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  realized_pnl?: number;
  leverage?: number;
  margin_usdt?: number;
}

export interface Broker {
  readonly tradingAccountId: string;
  readonly mode: BrokerMode;
  createOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult>;
  cancelOrder(orderId: string, symbol: string): Promise<BrokerOrderResult>;
  fetchBalance(botId?: string): Promise<Record<string, { free: number; used: number; total: number }>>;
  fetchPositions(botId?: string): Promise<Record<string, BrokerPosition>>;
  fetchOpenOrders(symbol?: string | null, botId?: string): Promise<BrokerOrderResult[]>;
  markToMarket(symbol: string, markPrice: number): Promise<void>;
}
