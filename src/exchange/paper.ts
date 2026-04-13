import { randomUUID } from "node:crypto";
import type { BaseExchange } from "./base.js";
import { LiveExchange } from "./live.js";

export class PaperExchange implements BaseExchange {
  private live: LiveExchange;
  private balance: Record<string, number>;
  _orders: Array<Record<string, any>> = [];
  private positions: Record<string, Record<string, any>> = {};

  constructor(exchangeId = "binance", initialBalance?: Record<string, number>) {
    this.live = new LiveExchange(exchangeId);
    this.balance = { ...(initialBalance ?? { USDT: 10000 }) };
  }

  fetchTicker(symbol: string) {
    return this.live.fetchTicker(symbol);
  }

  fetchOhlcv(symbol: string, timeframe = "1h", limit = 24) {
    return this.live.fetchOhlcv(symbol, timeframe, limit);
  }

  fetchOrderBook(symbol: string, limit = 10) {
    return this.live.fetchOrderBook(symbol, limit);
  }

  async createOrder(symbol: string, side: string, orderType: string, amount: number, price?: number | null) {
    const ticker = await this.live.fetchTicker(symbol);
    const execPrice: number = orderType === "limit" && price ? price : Number(ticker.last ?? 0);
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

    const orderId = randomUUID().slice(0, 8);
    const order = {
      id: orderId,
      symbol,
      side,
      type: orderType,
      amount,
      price: execPrice,
      status: "filled",
      created_at: new Date().toISOString(),
    };
    this._orders.push(order);
    this.updatePosition(symbol, side, amount, Number(execPrice));
    return order;
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

  async cancelOrder(_orderId: string, _symbol: string) {
    return { error: "Paper trading: market orders fill immediately" };
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

  async fetchOpenOrders(_symbol?: string | null) {
    return [];
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
