import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { BaseExchange } from "./base.js";
import { LiveExchange } from "./live.js";

interface PaperOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  amount: number;
  price: number;           // exec price (market) or limit price (limit)
  status: "open" | "filled" | "cancelled";
  created_at: string;
  filled_at?: string;
}

/**
 * Paper-mode exchange. Real market data from the wrapped LiveExchange, but
 * order fills are simulated in-memory.
 *
 * Market orders fill immediately at ticker.last.
 *
 * Limit orders are stored as "open" until either:
 *   - the price touches the limit (checked in processTick / fetchTicker), or
 *   - cancelOrder is called.
 *
 * On fill, emits 'orderFilled' so the OrderExecutor can upgrade the pending
 * row to an active position without polling.
 *
 * EventEmitter events:
 *   - 'orderFilled' (order: PaperOrder): a previously open limit order filled
 *   - 'orderCancelled' (order: PaperOrder): cancelled by caller
 */
export class PaperExchange extends EventEmitter implements BaseExchange {
  private live: LiveExchange;
  private balance: Record<string, number>;
  /** All orders ever seen (filled/cancelled kept for audit, open ones live here too). */
  _orders: PaperOrder[] = [];
  private positions: Record<string, Record<string, any>> = {};

  constructor(exchangeId = "binance", initialBalance?: Record<string, number>, httpsProxy = "") {
    super();
    this.live = new LiveExchange(exchangeId, "", "", "", httpsProxy);
    this.balance = { ...(initialBalance ?? { USDT: 10000 }) };
  }

  get exchangeId(): string {
    return this.live.exchangeId;
  }

  get ccxtInstance() {
    return this.live.ccxtInstance;
  }

  async fetchTicker(symbol: string) {
    const t = await this.live.fetchTicker(symbol);
    // Opportunistically process limit-order fills whenever someone asks for a ticker.
    const last = Number(t.last ?? 0);
    if (last > 0) this.processTick(symbol, last);
    return t;
  }

  fetchOhlcv(symbol: string, timeframe = "1h", limit = 24) {
    return this.live.fetchOhlcv(symbol, timeframe, limit);
  }

  fetchOrderBook(symbol: string, limit = 10) {
    return this.live.fetchOrderBook(symbol, limit);
  }

  /**
   * Check every open limit order on the given symbol. Fill any whose trigger
   * has been crossed by the current price.
   *
   * Fill rules (for long-side grid / ladder use cases):
   *   - buy limit: fills when last ≤ limitPrice (buyer got lucky, price came down)
   *   - sell limit: fills when last ≥ limitPrice
   */
  processTick(symbol: string, last: number): void {
    if (!(last > 0)) return;
    for (const o of this._orders) {
      if (o.status !== "open" || o.symbol !== symbol || o.type !== "limit") continue;
      const hit = o.side === "buy" ? last <= o.price : last >= o.price;
      if (!hit) continue;
      this.fillLimitOrder(o, o.price);
    }
  }

  private fillLimitOrder(o: PaperOrder, execPrice: number): void {
    const [base, quote] = o.symbol.split("/");
    if (o.side === "buy") {
      const cost = execPrice * o.amount;
      if ((this.balance[quote] ?? 0) < cost) {
        o.status = "cancelled";
        this.emit("orderCancelled", { ...o, reason: `Insufficient ${quote} at fill time` });
        return;
      }
      this.balance[quote] -= cost;
      this.balance[base] = (this.balance[base] ?? 0) + o.amount;
    } else {
      if ((this.balance[base] ?? 0) < o.amount) {
        o.status = "cancelled";
        this.emit("orderCancelled", { ...o, reason: `Insufficient ${base} at fill time` });
        return;
      }
      this.balance[base] -= o.amount;
      this.balance[quote] = (this.balance[quote] ?? 0) + execPrice * o.amount;
    }
    o.status = "filled";
    o.filled_at = new Date().toISOString();
    this.updatePosition(o.symbol, o.side, o.amount, execPrice);
    this.emit("orderFilled", { ...o, price: execPrice });
  }

  async createOrder(symbol: string, side: string, orderType: string, amount: number, price?: number | null) {
    if (side !== "buy" && side !== "sell") {
      return { error: `Invalid side: ${side}` };
    }

    if (orderType === "limit") {
      if (!price || price <= 0) return { error: "limit order requires a positive price" };
      const order: PaperOrder = {
        id: randomUUID().slice(0, 8),
        symbol,
        side,
        type: "limit",
        amount,
        price,
        status: "open",
        created_at: new Date().toISOString(),
      };
      this._orders.push(order);
      // Opportunistically attempt immediate fill if already in-the-money.
      try {
        const t = await this.live.fetchTicker(symbol);
        const last = Number(t.last ?? 0);
        if (last > 0) {
          const hit = side === "buy" ? last <= price : last >= price;
          if (hit) this.fillLimitOrder(order, price);
        }
      } catch {
        // ignore — next processTick will handle it
      }
      return { ...order };
    }

    // Market order: immediate fill at ticker.last
    const ticker = await this.live.fetchTicker(symbol);
    const execPrice = Number(ticker.last ?? 0);
    if (!(execPrice > 0)) return { error: "Unable to price market order (ticker unavailable)" };
    const [base, quote] = symbol.split("/");

    if (side === "buy") {
      const cost = execPrice * amount;
      if ((this.balance[quote] ?? 0) < cost) {
        return {
          error: `Insufficient ${quote}: need ${cost.toFixed(2)}, have ${(this.balance[quote] ?? 0).toFixed(2)}`,
        };
      }
      this.balance[quote] -= cost;
      this.balance[base] = (this.balance[base] ?? 0) + amount;
    } else {
      if ((this.balance[base] ?? 0) < amount) {
        return { error: `Insufficient ${base}: need ${amount}, have ${this.balance[base] ?? 0}` };
      }
      this.balance[base] -= amount;
      this.balance[quote] = (this.balance[quote] ?? 0) + execPrice * amount;
    }

    const order: PaperOrder = {
      id: randomUUID().slice(0, 8),
      symbol,
      side,
      type: "market",
      amount,
      price: execPrice,
      status: "filled",
      created_at: new Date().toISOString(),
      filled_at: new Date().toISOString(),
    };
    this._orders.push(order);
    this.updatePosition(symbol, side, amount, execPrice);
    return { ...order };
  }

  private updatePosition(symbol: string, side: string, amount: number, price: number): void {
    const pos = this.positions[symbol] ?? { symbol, amount: 0, avg_entry_price: 0 };
    if (side === "buy") {
      const totalCost = pos.avg_entry_price * pos.amount + price * amount;
      pos.amount += amount;
      pos.avg_entry_price = pos.amount > 0 ? totalCost / pos.amount : 0;
    } else {
      pos.amount -= amount;
      if (pos.amount <= 1e-10) {
        delete this.positions[symbol];
        return;
      }
    }
    this.positions[symbol] = pos;
  }

  async cancelOrder(orderId: string, _symbol: string) {
    const order = this._orders.find((o) => o.id === orderId);
    if (!order) return { error: `Order ${orderId} not found` };
    if (order.status !== "open") {
      return { error: `Order ${orderId} is ${order.status}, cannot cancel` };
    }
    order.status = "cancelled";
    this.emit("orderCancelled", { ...order, reason: "Cancelled by caller" });
    return { id: order.id, status: "cancelled" };
  }

  async fetchBalance() {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(this.balance)) {
      if (v > 1e-10) {
        result[k] = { free: v, used: 0, total: v };
      }
    }
    return result;
  }

  async fetchOpenOrders(symbol?: string | null) {
    return this._orders
      .filter((o) => o.status === "open" && (!symbol || o.symbol === symbol))
      .map((o) => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        amount: o.amount,
        price: o.price,
        status: o.status,
      }));
  }

  async fetchPositions() {
    const result: Record<string, any> = {};
    for (const [sym, pos] of Object.entries(this.positions)) {
      try {
        const ticker = await this.live.fetchTicker(sym);
        pos.current_price = Number(ticker.last ?? 0);
        pos.unrealized_pnl = Math.round((Number(ticker.last ?? 0) - pos.avg_entry_price) * pos.amount * 100) / 100;
      } catch {
        pos.current_price = pos.avg_entry_price;
        pos.unrealized_pnl = 0;
      }
      result[sym] = pos;
    }
    return result;
  }

  async close() {
    await this.live.close();
  }
}
