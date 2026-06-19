import { Strategy, type StrategyContext } from "./base.js";
import type { Tick } from "../market-feed.js";
import type { Signal } from "./state.js";

export interface GridStrategyParams {
  side: "long"; // short/bi-directional are future extensions
  lowerPrice: number;
  upperPrice: number;
  gridCount: number; // number of levels (must be >= 2)
  sizePerGrid: number; // USDT notional per level
}

interface GridLevel {
  idx: number;
  price: number;
  /** positionId slot for this level. Stays the same across fill cycles so
   * pending_orders rows are keyed consistently and the Strategy can tell
   * "which grid line" a fill belongs to. */
  positionId: string;
  /** Current state: waiting to buy, filled (holding), waiting to sell. */
  state: "idle" | "buy_pending" | "holding" | "sell_pending";
  /** Exchange order id of the currently outstanding limit, if any. */
  pendingOrderId: string | null;
}

/**
 * Long-only grid. Divides [lowerPrice, upperPrice] into gridCount levels and
 * keeps a resting limit buy at each level. When a buy fills, the Strategy
 * replaces it with a limit sell at the NEXT level up (one grid spacing
 * higher). When that sell fills, a new buy goes back on the original level.
 * This is the textbook "buy low, sell high, repeat" grid behavior.
 *
 * Relies on the B3 event loop:
 *   - ctx.emitSignal with orderType='limit' → OrderExecutor places the order
 *     and stores pending_orders, but doesn't build a position yet.
 *   - PaperBroker.markToMarket (or live polling) detects the limit cross
 *     and emits 'orderFilled'.
 *   - OrderExecutor.onExchangeFill finalizes → emits "entered" / "exited".
 *   - Runtime forwards those to Strategy.onOrderFilled here, where we
 *     advance the level's state machine and place the next order.
 */
export class GridStrategy extends Strategy {
  readonly kind = "grid";
  private levels: GridLevel[] = [];
  private spacing = 0;

  constructor(opts: {
    id: string;
    symbol: string;
    params: GridStrategyParams;
    enabled?: boolean;
    allocatedUsdt?: number;
    createdAt?: string;
    updatedAt?: string;
  }) {
    super(opts);
  }

  get lowerPrice(): number {
    return (this.params as GridStrategyParams).lowerPrice;
  }
  get upperPrice(): number {
    return (this.params as GridStrategyParams).upperPrice;
  }
  get gridCount(): number {
    return (this.params as GridStrategyParams).gridCount;
  }
  get sizePerGrid(): number {
    return (this.params as GridStrategyParams).sizePerGrid;
  }

  requiredSubscriptions() {
    return [{ type: "ticker" as const, symbol: this.symbol }];
  }

  start(ctx: StrategyContext): void {
    this.ctx = ctx;
    this.buildLevels();
    ctx.feed.subscribeTicker(this.symbol, (tick) => this.onTick(tick));
    // Kick off initial buy orders at every level. In principle we should only
    // place buys at levels that are currently *below* market; levels above
    // market would fill instantly (we'd be "buying the top"). A buy limit
    // above market effectively becomes a market buy — not what a grid wants.
    // So defer placement until the first tick tells us where market is.
  }

  stop(): void {
    // Runtime handles cascade-cancel of open orders via memory.getOpenPendingOrdersByStrategy.
    this.ctx = null;
    this.levels = [];
  }

  private buildLevels(): void {
    const p = this.params as GridStrategyParams;
    if (p.gridCount < 2) throw new Error("grid gridCount must be >= 2");
    this.spacing = (p.upperPrice - p.lowerPrice) / (p.gridCount - 1);
    this.levels = [];
    for (let i = 0; i < p.gridCount; i++) {
      const price = p.lowerPrice + i * this.spacing;
      this.levels.push({
        idx: i,
        price,
        positionId: `${this.id}:G${i}`,
        state: "idle",
        pendingOrderId: null,
      });
    }
  }

  onTick(tick: Tick): void {
    if (!this.enabled || !this.ctx) return;
    if (tick.symbol !== this.symbol) return;

    // First-tick initialization: place a buy limit at every level strictly
    // below current market. Levels above market stay idle until their
    // matching sell gets triggered by a fill cycle.
    for (const lvl of this.levels) {
      if (lvl.state !== "idle") continue;
      if (lvl.price >= tick.last) continue; // would fill immediately → skip
      this.placeBuy(lvl);
    }
  }

  private placeBuy(lvl: GridLevel): void {
    if (!this.ctx) return;
    lvl.state = "buy_pending";
    this.ctx.emitSignal({
      ruleId: this.id,
      positionId: lvl.positionId,
      symbol: this.symbol,
      side: "long",
      action: "enter",
      sizeUsdt: this.sizePerGrid,
      reason: `Grid L${lvl.idx}: buy @ ${lvl.price}`,
      timestamp: Date.now(),
      orderType: "limit",
      limitPrice: lvl.price,
    } satisfies Signal);
  }

  private placeSell(lvl: GridLevel): void {
    if (!this.ctx) return;
    // Sell one grid spacing above the buy. For the topmost level there's no
    // "above" — sell at upperPrice + spacing (synthetic; will just rest
    // indefinitely if price never reaches it).
    const sellPrice = lvl.price + this.spacing;
    lvl.state = "sell_pending";
    this.ctx.emitSignal({
      ruleId: this.id,
      positionId: lvl.positionId,
      symbol: this.symbol,
      side: "long",
      action: "exit",
      sizeUsdt: this.sizePerGrid,
      reason: `Grid L${lvl.idx}: sell @ ${sellPrice}`,
      timestamp: Date.now(),
      orderType: "limit",
      limitPrice: sellPrice,
    } satisfies Signal);
  }

  onOrderFilled(order: Record<string, any>): void {
    const positionId = order.positionId as string | undefined;
    if (!positionId) return;
    const lvl = this.levels.find((l) => l.positionId === positionId);
    if (!lvl) return;

    if (order.action === "enter") {
      // Buy at this level filled — we're now holding a slug. Place a sell
      // one grid up to take profit on the spread.
      lvl.state = "holding";
      this.placeSell(lvl);
    } else if (order.action === "exit") {
      // Sell filled — slug closed. Put the buy back on this level for the
      // next cycle.
      lvl.state = "idle";
      this.placeBuy(lvl);
    }
  }

  // Introspection for tests / /strategies render.
  get levelStates() {
    return this.levels.map((l) => ({ idx: l.idx, price: l.price, state: l.state }));
  }
}
