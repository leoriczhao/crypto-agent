import { EventEmitter } from "node:events";
import type { MarketFeed, Tick, Candle } from "../market-feed.js";
import type { Signal, RiskParams } from "./state.js";

/**
 * Injected dependencies + callbacks a Strategy needs. Created by the daemon
 * and passed to every Strategy via start(ctx). Keeps strategies decoupled
 * from the concrete SignalEngine / OrderExecutor / Memory wiring.
 */
export interface StrategyContext {
  feed: MarketFeed;
  /** How a Strategy hands a trade decision to the execution pipeline. */
  emitSignal: (signal: Signal) => void;
  /** Cancel a previously-placed limit order by exchange order id.
   * Strategies (Grid, etc.) that manage their own resting orders use this. */
  cancelOrder?: (exchangeOrderId: string, symbol: string) => Promise<void>;
  /** Read-only snapshot of current account-level risk limits. */
  getRiskParams: () => RiskParams;
  /** Fire-and-forget structured log, written to the events table. */
  log?: (type: string, data: string) => void;
}

/**
 * Base class for every trading strategy (signal, grid, dca, market-making…).
 *
 * A Strategy is a stateful object with its own lifecycle — started by the
 * daemon, subscribes to the market data it needs, and emits Signals to the
 * shared execution pipeline (OrderExecutor).
 *
 * Subclasses MUST override:
 *   - `kind` (string tag for persistence + dispatch)
 *   - `start(ctx)` — subscribe + restore internal state
 *   - `stop()` — unsubscribe, flush
 *
 * Subclasses SHOULD override the event hooks they care about and leave
 * the others as no-ops.
 */
export abstract class Strategy extends EventEmitter {
  abstract readonly kind: string;

  readonly id: string;
  readonly symbol: string;
  enabled: boolean;
  /** Strategy-specific parameter bag, persisted as JSON. */
  readonly params: Record<string, any>;
  /** USDT budget this strategy is allowed to consume. 0 = no cap (B2 enforces). */
  allocatedUsdt: number;

  readonly createdAt: string;
  updatedAt: string;

  protected ctx: StrategyContext | null = null;

  constructor(opts: {
    id: string;
    symbol: string;
    params: Record<string, any>;
    enabled?: boolean;
    allocatedUsdt?: number;
    createdAt?: string;
    updatedAt?: string;
  }) {
    super();
    this.id = opts.id;
    this.symbol = opts.symbol;
    this.params = opts.params;
    this.enabled = opts.enabled ?? true;
    this.allocatedUsdt = opts.allocatedUsdt ?? 0;
    this.createdAt = opts.createdAt ?? new Date().toISOString();
    this.updatedAt = opts.updatedAt ?? this.createdAt;
  }

  abstract start(ctx: StrategyContext): void;
  abstract stop(): void;

  // Event hooks — default no-op. Subclasses override what they need.
  onTick(_tick: Tick): void {}
  onCandle(_candle: Candle): void {}
  onOrderFilled(_order: Record<string, any>): void {}
  onPositionClosed(_pnl: number): void {}

  /**
   * Symbols this strategy needs the MarketFeed to deliver. Used by the daemon
   * at startup to know which subscriptions to create.
   */
  abstract requiredSubscriptions(): Array<
    | { type: "ticker"; symbol: string }
    | { type: "ohlcv"; symbol: string; timeframe: string }
    | { type: "orderbook"; symbol: string }
  >;
}

/**
 * Serialized form for persistence. A Strategy can be rebuilt from this plus
 * the kind-specific factory (see StrategyManager).
 */
export interface StrategySnapshot {
  id: string;
  kind: string;
  symbol: string;
  params: Record<string, any>;
  enabled: boolean;
  allocatedUsdt: number;
  botId?: string | null;
  tradingAccountId?: string | null;
  createdAt: string;
  updatedAt: string;
}
