import { randomUUID } from "node:crypto";
import type { Memory, PaperOrderRow, PaperPositionRow } from "../memory.js";
import type { MarketDataProvider } from "../market-data/types.js";
import { normalizeSymbol } from "./symbols.js";
import type {
  Broker,
  BrokerOrderRequest,
  BrokerOrderResult,
  BrokerPosition,
  BrokerPositionSide,
} from "./types.js";

const EPSILON = 1e-10;

export class PaperBroker implements Broker {
  readonly mode = "PAPER" as const;
  readonly tradingAccountId: string;
  private memory: Memory;
  private marketData: MarketDataProvider;

  constructor(opts: { memory: Memory; marketData: MarketDataProvider; tradingAccountId: string }) {
    this.memory = opts.memory;
    this.marketData = opts.marketData;
    this.tradingAccountId = opts.tradingAccountId;
  }

  async createOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult> {
    if (request.tradingAccountId !== this.tradingAccountId) {
      return this.rejected(request, `Trading account mismatch: ${request.tradingAccountId}`);
    }
    if (!(request.amount > 0)) return this.rejected(request, "amount must be > 0");
    if (request.orderType === "limit" && !(Number(request.price) > 0)) {
      return this.rejected(request, "limit order requires a positive price");
    }

    const normalized = normalizeSymbol(request.symbol, request.marketType);
    const now = new Date().toISOString();
    const price = request.orderType === "market"
      ? Number((await this.marketData.fetchTicker(normalized.symbol)).last ?? 0)
      : Number(request.price);
    if (!(price > 0)) return this.rejected(request, "Unable to price order");

    const order = this.memory.createPaperOrder({
      id: `paper-${randomUUID().slice(0, 12)}`,
      tradingAccountId: request.tradingAccountId,
      botId: request.botId,
      actorType: request.actorType,
      actorId: request.actorId ?? null,
      symbol: normalized.symbol,
      marketType: normalized.marketType,
      side: request.side,
      positionSide: request.positionSide ?? this.defaultPositionSide(request.side),
      orderType: request.orderType,
      amount: request.amount,
      price,
      leverage: request.leverage ?? null,
      reduceOnly: request.reduceOnly ?? false,
      status: request.orderType === "market" ? "filled" : "open",
      filledAt: request.orderType === "market" ? now : null,
    });

    if (request.orderType === "limit") {
      const ticker = await this.marketData.fetchTicker(normalized.symbol).catch(() => null);
      const last = Number(ticker?.last ?? 0);
      if (last > 0 && this.limitHit(order, last)) {
        return this.fillOrder(order, price);
      }
      return this.rowToOrderResult(order);
    }

    return this.fillOrder(order, price);
  }

  async cancelOrder(orderId: string, _symbol: string): Promise<BrokerOrderResult> {
    const order = this.memory.getPaperOrder(orderId);
    if (!order) {
      return {
        id: orderId,
        symbol: _symbol,
        marketType: "spot",
        side: "buy",
        type: "limit",
        amount: 0,
        price: null,
        status: "rejected",
        error: `Order ${orderId} not found`,
      };
    }
    if (order.status !== "open") {
      return { ...this.rowToOrderResult(order), error: `Order ${orderId} is ${order.status}, cannot cancel` };
    }
    this.memory.updatePaperOrder(order.id, { status: "cancelled" });
    return { ...this.rowToOrderResult(order), status: "cancelled" };
  }

  async fetchBalance(botId?: string): Promise<Record<string, { free: number; used: number; total: number }>> {
    const result: Record<string, { free: number; used: number; total: number }> = {};
    const allocations = this.memory.listBotAllocations({ tradingAccountId: this.tradingAccountId, botId });
    const positions = this.memory.listPaperPositions({ tradingAccountId: this.tradingAccountId, botId });
    const unrealizedUsdt = positions
      .filter((p) => p.marketType === "swap")
      .reduce((sum, p) => sum + p.unrealizedPnl, 0);

    for (const a of allocations) {
      if (Math.abs(a.free) <= EPSILON && Math.abs(a.used) <= EPSILON && Math.abs(a.allocated) <= EPSILON) continue;
      const total = a.asset === "USDT" ? a.free + a.used + unrealizedUsdt : a.free + a.used;
      result[a.asset] = {
        free: this.round(a.free),
        used: this.round(a.used),
        total: this.round(total),
      };
    }
    return result;
  }

  async fetchPositions(botId?: string): Promise<Record<string, BrokerPosition>> {
    const result: Record<string, BrokerPosition> = {};
    for (const p of this.memory.listPaperPositions({ tradingAccountId: this.tradingAccountId, botId })) {
      if (Math.abs(p.amount) <= EPSILON) continue;
      const value: BrokerPosition = {
        symbol: p.symbol,
        marketType: p.marketType,
        side: p.positionSide,
        amount: p.amount,
        contracts: p.amount,
        avg_entry_price: p.avgEntryPrice,
        current_price: p.markPrice,
        unrealized_pnl: this.round(p.unrealizedPnl),
        realized_pnl: this.round(p.realizedPnl),
        leverage: p.leverage,
        margin_usdt: this.round(p.marginUsdt),
      };
      if (p.marketType === "spot") {
        result[p.symbol] = value;
        result[`${p.symbol}:${p.positionSide}`] = value;
      } else {
        result[`${p.symbol}:${p.positionSide}`] = value;
      }
    }
    return result;
  }

  async fetchOpenOrders(symbol?: string | null, botId?: string): Promise<BrokerOrderResult[]> {
    return this.memory
      .listPaperOpenOrders({ tradingAccountId: this.tradingAccountId, botId, symbol })
      .map((o) => this.rowToOrderResult(o));
  }

  async markToMarket(symbol: string, markPrice: number): Promise<void> {
    if (!(markPrice > 0)) return;
    const normalized = normalizeSymbol(symbol);
    for (const pos of this.memory.listPaperPositions({ tradingAccountId: this.tradingAccountId, symbol: normalized.symbol })) {
      if (pos.marketType !== "swap") continue;
      const unrealizedPnl = this.computePnl(pos.positionSide, pos.avgEntryPrice, markPrice, pos.amount);
      this.memory.upsertPaperPosition({ ...pos, markPrice, unrealizedPnl });
    }

    const open = this.memory.listPaperOpenOrders({ tradingAccountId: this.tradingAccountId, symbol: normalized.symbol });
    for (const order of open) {
      if (!this.limitHit(order, markPrice)) continue;
      await this.fillOrder(order, order.price ?? markPrice);
    }
  }

  private async fillOrder(order: PaperOrderRow, execPrice: number): Promise<BrokerOrderResult> {
    const normalized = normalizeSymbol(order.symbol, order.marketType);
    if (normalized.marketType === "spot") return this.fillSpotOrder(order, execPrice);
    return this.fillSwapOrder(order, execPrice);
  }

  private fillSpotOrder(order: PaperOrderRow, execPrice: number): BrokerOrderResult {
    const normalized = normalizeSymbol(order.symbol, "spot");
    if (order.side === "buy") {
      const cost = execPrice * order.amount;
      const quote = this.memory.getBotAllocation(order.botId, order.tradingAccountId, normalized.quote);
      if ((quote?.free ?? 0) + EPSILON < cost) {
        this.memory.updatePaperOrder(order.id, { status: "cancelled" });
        return { ...this.rowToOrderResult(order), status: "cancelled", error: `Insufficient ${normalized.quote}` };
      }
      this.memory.updateBotAllocation({
        botId: order.botId,
        tradingAccountId: order.tradingAccountId,
        asset: normalized.quote,
        freeDelta: -cost,
      });
      this.memory.updateBotAllocation({
        botId: order.botId,
        tradingAccountId: order.tradingAccountId,
        asset: normalized.base,
        freeDelta: order.amount,
      });
      this.upsertSpotPosition(order, execPrice, "buy");
    } else {
      const base = this.memory.getBotAllocation(order.botId, order.tradingAccountId, normalized.base);
      if ((base?.free ?? 0) + EPSILON < order.amount) {
        this.memory.updatePaperOrder(order.id, { status: "cancelled" });
        return { ...this.rowToOrderResult(order), status: "cancelled", error: `Insufficient ${normalized.base}` };
      }
      this.memory.updateBotAllocation({
        botId: order.botId,
        tradingAccountId: order.tradingAccountId,
        asset: normalized.base,
        freeDelta: -order.amount,
      });
      this.memory.updateBotAllocation({
        botId: order.botId,
        tradingAccountId: order.tradingAccountId,
        asset: normalized.quote,
        freeDelta: execPrice * order.amount,
      });
      this.upsertSpotPosition(order, execPrice, "sell");
    }

    this.recordFill(order, execPrice, 0);
    return { ...this.rowToOrderResult(order), status: "filled", price: execPrice, filled_at: new Date().toISOString() };
  }

  private fillSwapOrder(order: PaperOrderRow, execPrice: number): BrokerOrderResult {
    const positionSide = order.positionSide ?? this.defaultPositionSide(order.side);
    const leverage = order.leverage ?? 1;
    if (!(leverage > 0)) return { ...this.rowToOrderResult(order), status: "rejected", error: "leverage must be > 0" };
    return order.reduceOnly
      ? this.closeSwapPosition(order, execPrice, positionSide)
      : this.openSwapPosition(order, execPrice, positionSide, leverage);
  }

  private openSwapPosition(order: PaperOrderRow, execPrice: number, positionSide: BrokerPositionSide, leverage: number): BrokerOrderResult {
    const notional = execPrice * order.amount;
    const margin = notional / leverage;
    const usdt = this.memory.getBotAllocation(order.botId, order.tradingAccountId, "USDT");
    if ((usdt?.free ?? 0) + EPSILON < margin) {
      this.memory.updatePaperOrder(order.id, { status: "cancelled" });
      return { ...this.rowToOrderResult(order), status: "cancelled", error: "Insufficient USDT margin" };
    }

    const id = this.positionId(order.tradingAccountId, order.botId, order.symbol, positionSide);
    const existing = this.memory.listPaperPositions({
      tradingAccountId: order.tradingAccountId,
      botId: order.botId,
      symbol: order.symbol,
    }).find((p) => p.id === id);
    const amount = (existing?.amount ?? 0) + order.amount;
    const avgEntryPrice = amount > 0
      ? (((existing?.avgEntryPrice ?? 0) * (existing?.amount ?? 0)) + execPrice * order.amount) / amount
      : execPrice;
    const marginUsdt = (existing?.marginUsdt ?? 0) + margin;
    const unrealizedPnl = this.computePnl(positionSide, avgEntryPrice, execPrice, amount);

    this.memory.updateBotAllocation({
      botId: order.botId,
      tradingAccountId: order.tradingAccountId,
      asset: "USDT",
      freeDelta: -margin,
      usedDelta: margin,
    });
    this.memory.upsertPaperPosition({
      id,
      tradingAccountId: order.tradingAccountId,
      botId: order.botId,
      symbol: order.symbol,
      marketType: "swap",
      positionSide,
      amount,
      avgEntryPrice,
      markPrice: execPrice,
      leverage,
      marginUsdt,
      unrealizedPnl,
      realizedPnl: existing?.realizedPnl ?? 0,
    });
    this.recordFill(order, execPrice, 0);
    return { ...this.rowToOrderResult(order), status: "filled", price: execPrice, filled_at: new Date().toISOString() };
  }

  private closeSwapPosition(order: PaperOrderRow, execPrice: number, positionSide: BrokerPositionSide): BrokerOrderResult {
    const id = this.positionId(order.tradingAccountId, order.botId, order.symbol, positionSide);
    const pos = this.memory.listPaperPositions({
      tradingAccountId: order.tradingAccountId,
      botId: order.botId,
      symbol: order.symbol,
    }).find((p) => p.id === id);
    if (!pos) return { ...this.rowToOrderResult(order), status: "rejected", error: `No ${positionSide} position for ${order.symbol}` };
    if (order.amount > pos.amount + EPSILON) {
      return { ...this.rowToOrderResult(order), status: "rejected", error: "reduce amount exceeds position amount" };
    }

    const closeRatio = order.amount / pos.amount;
    const marginRelease = pos.marginUsdt * closeRatio;
    const realizedPnl = this.computePnl(positionSide, pos.avgEntryPrice, execPrice, order.amount);
    this.memory.updateBotAllocation({
      botId: order.botId,
      tradingAccountId: order.tradingAccountId,
      asset: "USDT",
      freeDelta: marginRelease + realizedPnl,
      usedDelta: -marginRelease,
      realizedPnlDelta: realizedPnl,
    });

    const remaining = pos.amount - order.amount;
    if (remaining <= EPSILON) {
      this.memory.deletePaperPosition(id);
    } else {
      this.memory.upsertPaperPosition({
        ...pos,
        amount: remaining,
        markPrice: execPrice,
        marginUsdt: pos.marginUsdt - marginRelease,
        unrealizedPnl: this.computePnl(positionSide, pos.avgEntryPrice, execPrice, remaining),
        realizedPnl: pos.realizedPnl + realizedPnl,
      });
    }

    this.recordFill(order, execPrice, realizedPnl);
    return { ...this.rowToOrderResult(order), status: "filled", price: execPrice, filled_at: new Date().toISOString() };
  }

  private upsertSpotPosition(order: PaperOrderRow, execPrice: number, action: "buy" | "sell"): void {
    const id = this.positionId(order.tradingAccountId, order.botId, order.symbol, "long");
    const existing = this.memory.listPaperPositions({
      tradingAccountId: order.tradingAccountId,
      botId: order.botId,
      symbol: order.symbol,
    }).find((p) => p.id === id);

    if (action === "buy") {
      const oldAmount = existing?.amount ?? 0;
      const newAmount = oldAmount + order.amount;
      const avgEntryPrice = newAmount > 0
        ? (((existing?.avgEntryPrice ?? 0) * oldAmount) + execPrice * order.amount) / newAmount
        : execPrice;
      this.memory.upsertPaperPosition({
        id,
        tradingAccountId: order.tradingAccountId,
        botId: order.botId,
        symbol: order.symbol,
        marketType: "spot",
        positionSide: "long",
        amount: newAmount,
        avgEntryPrice,
        markPrice: execPrice,
        leverage: 1,
        marginUsdt: 0,
        unrealizedPnl: (execPrice - avgEntryPrice) * newAmount,
        realizedPnl: existing?.realizedPnl ?? 0,
      });
      return;
    }

    if (!existing) return;
    const remaining = existing.amount - order.amount;
    if (remaining <= EPSILON) {
      this.memory.deletePaperPosition(id);
    } else {
      this.memory.upsertPaperPosition({
        ...existing,
        amount: remaining,
        markPrice: execPrice,
        unrealizedPnl: (execPrice - existing.avgEntryPrice) * remaining,
      });
    }
  }

  private recordFill(order: PaperOrderRow, execPrice: number, realizedPnl: number): void {
    const filledAt = new Date().toISOString();
    this.memory.updatePaperOrder(order.id, { status: "filled", filledAt, price: execPrice });
    this.memory.insertPaperFill({
      orderId: order.id,
      tradingAccountId: order.tradingAccountId,
      botId: order.botId,
      actorType: order.actorType,
      actorId: order.actorId,
      symbol: order.symbol,
      marketType: order.marketType,
      side: order.side,
      positionSide: order.positionSide,
      amount: order.amount,
      price: execPrice,
      feeUsdt: 0,
      realizedPnl,
    });
  }

  private limitHit(order: PaperOrderRow, markPrice: number): boolean {
    if (order.orderType !== "limit" || order.price == null) return false;
    return order.side === "buy" ? markPrice <= order.price : markPrice >= order.price;
  }

  private positionId(tradingAccountId: string, botId: string, symbol: string, side: BrokerPositionSide): string {
    return `${tradingAccountId}:${botId}:${symbol}:${side}`;
  }

  private defaultPositionSide(side: string): BrokerPositionSide {
    return side === "sell" ? "short" : "long";
  }

  private computePnl(side: BrokerPositionSide, entry: number, mark: number, amount: number): number {
    return side === "long" ? (mark - entry) * amount : (entry - mark) * amount;
  }

  private rowToOrderResult(order: PaperOrderRow): BrokerOrderResult {
    return {
      id: order.id,
      symbol: order.symbol,
      marketType: order.marketType,
      side: order.side as "buy" | "sell",
      positionSide: order.positionSide,
      type: order.orderType,
      amount: order.amount,
      price: order.price,
      leverage: order.leverage,
      reduceOnly: order.reduceOnly,
      status: order.status as BrokerOrderResult["status"],
      created_at: order.createdAt,
      filled_at: order.filledAt,
    };
  }

  private rejected(request: BrokerOrderRequest, error: string): BrokerOrderResult {
    return {
      id: "",
      symbol: request.symbol,
      marketType: request.marketType,
      side: request.side,
      positionSide: request.positionSide ?? this.defaultPositionSide(request.side),
      type: request.orderType,
      amount: request.amount,
      price: request.price ?? null,
      leverage: request.leverage ?? null,
      reduceOnly: request.reduceOnly ?? false,
      status: "rejected",
      error,
    };
  }

  private round(value: number): number {
    return Math.round(value * 1e10) / 1e10;
  }
}
