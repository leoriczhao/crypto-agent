import type { BaseExchange } from "./exchange/base.js";
import type { Broker } from "./broker/types.js";
import type { RiskParams } from "./strategy/state.js";

export interface TradeGuardContext {
  exchange?: BaseExchange | null;
  broker?: Broker | null;
  botId?: string;
  riskParams: RiskParams;
  /** Soul's max_position_pct — acts as a hard ceiling on riskParams.maxPositionPct */
  soulMaxPositionPct: number;
  maxOrderSizeUsdt: number;
  initialBalanceUsdt: number;
  /** Current day's realized PnL (negative for loss). If omitted, daily-loss check is skipped. */
  dailyPnl?: number;
  /** Per-strategy budget (B2). Allocated = hard cap; used = capital currently
   * locked in open positions for this strategy. If omitted, strategy-level
   * check is skipped (for LLM-driven trades with no owning strategy). */
  strategyAllocatedUsdt?: number;
  strategyUsedUsdt?: number;
  strategyId?: string;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  warnings: string[];
}

/**
 * Sole authority for "is this trade allowed to execute".
 *
 * Both the slow path (LLM buy/sell tools) and the fast path (RiskGate) call this.
 * The checks apply in two groups:
 *
 *  Always checked (buy AND sell):
 *   - Max order size (hard config cap)
 *   - Portfolio drawdown (riskParams.maxDrawdownPct)
 *   - Daily loss (riskParams.maxDailyLossPct) — if dailyPnl provided
 *
 *  Buy-only (entries that increase exposure):
 *   - Position size: MIN(riskParams.maxPositionPct, soulMaxPositionPct) — Soul is hard ceiling
 *   - Total exposure: riskParams.maxExposurePct
 *   - Concurrent positions: riskParams.maxConcurrentPositions
 *   - Sufficient free balance
 */
export async function checkTradeAllowed(
  ctx: TradeGuardContext,
  symbol: string,
  side: string,
  amountUsdt: number,
): Promise<GuardResult> {
  const warnings: string[] = [];
  const rp = ctx.riskParams;

  // 1. Max order size (always)
  if (amountUsdt > ctx.maxOrderSizeUsdt) {
    return reject(
      `Order size $${amountUsdt.toFixed(2)} exceeds max $${ctx.maxOrderSizeUsdt.toFixed(2)}`,
    );
  }

  // Fetch portfolio state
  let balance: Record<string, any>;
  let positions: Record<string, any>;
  try {
    if (ctx.broker) {
      balance = await ctx.broker.fetchBalance(ctx.botId);
      positions = await ctx.broker.fetchPositions(ctx.botId);
    } else if (ctx.exchange) {
      balance = await ctx.exchange.fetchBalance();
      positions = await ctx.exchange.fetchPositions();
    } else {
      return reject("Risk check failed: no account source");
    }
  } catch (err: any) {
    return reject(`Risk check failed: ${err.message ?? err}`);
  }

  const usdtFree = balance.USDT?.free ?? balance.USDT?.total ?? 0;

  let totalExposure = 0;
  let positionCount = 0;
  for (const pos of Object.values(positions) as any[]) {
    const value = Math.abs(
      (pos.amount ?? 0) * (pos.current_price ?? pos.avg_entry_price ?? 0),
    );
    if (value > 0) {
      totalExposure += value;
      positionCount++;
    }
  }

  const portfolioValue = usdtFree + totalExposure;

  // 2. Drawdown (always)
  if (ctx.initialBalanceUsdt > 0) {
    const drawdownPct =
      ((ctx.initialBalanceUsdt - portfolioValue) / ctx.initialBalanceUsdt) * 100;
    if (drawdownPct > rp.maxDrawdownPct) {
      return reject(
        `Portfolio drawdown ${drawdownPct.toFixed(1)}% exceeds ${rp.maxDrawdownPct}% limit — trading halted`,
      );
    }
  }

  // 3. Daily loss (always, if tracked)
  if (ctx.dailyPnl !== undefined && ctx.dailyPnl < 0 && ctx.initialBalanceUsdt > 0) {
    const dailyLossPct = (Math.abs(ctx.dailyPnl) / ctx.initialBalanceUsdt) * 100;
    if (dailyLossPct > rp.maxDailyLossPct) {
      return reject(
        `Daily loss ${dailyLossPct.toFixed(1)}% exceeds ${rp.maxDailyLossPct}% limit`,
      );
    }
  }

  // Buy-only checks
  if (side === "buy") {
    // 3b. Strategy-level budget (B2): fast-path signals carry their owning
    // strategy's allocation + current usage. If the new entry would push
    // usage over allocation, reject — this is the Hummingbot-style budget
    // isolation so one strategy can't drain capital from others.
    if (
      ctx.strategyAllocatedUsdt !== undefined &&
      ctx.strategyUsedUsdt !== undefined
    ) {
      const after = ctx.strategyUsedUsdt + amountUsdt;
      if (after > ctx.strategyAllocatedUsdt) {
        const who = ctx.strategyId ? ` (strategy ${ctx.strategyId.slice(0, 8)})` : "";
        return reject(
          `Strategy budget${who}: $${ctx.strategyUsedUsdt.toFixed(2)} in use + $${amountUsdt.toFixed(2)} entry > $${ctx.strategyAllocatedUsdt.toFixed(2)} allocated`,
        );
      }
    }

    const effectiveMaxPos = Math.min(rp.maxPositionPct, ctx.soulMaxPositionPct);

    // 4. Position size (soul ceiling wins if lower than risk params)
    if (portfolioValue > 0) {
      const positionPct = (amountUsdt / portfolioValue) * 100;
      if (positionPct > effectiveMaxPos) {
        const source = effectiveMaxPos === ctx.soulMaxPositionPct && effectiveMaxPos < rp.maxPositionPct
          ? "soul ceiling"
          : "risk params";
        return reject(
          `Position size ${positionPct.toFixed(1)}% exceeds ${effectiveMaxPos}% limit (${source})`,
        );
      }
      if (positionPct > effectiveMaxPos * 0.8) {
        warnings.push(
          `Position size ${positionPct.toFixed(1)}% is near the ${effectiveMaxPos}% limit`,
        );
      }
    }

    // 5. Total exposure
    if (portfolioValue > 0) {
      const newExposurePct = ((totalExposure + amountUsdt) / portfolioValue) * 100;
      if (newExposurePct > rp.maxExposurePct) {
        return reject(
          `Total exposure would be ${newExposurePct.toFixed(1)}%, exceeds ${rp.maxExposurePct}% limit`,
        );
      }
    }

    // 6. Concurrent positions
    if (positionCount >= rp.maxConcurrentPositions) {
      return reject(
        `Already ${positionCount} positions, max is ${rp.maxConcurrentPositions}`,
      );
    }

    // 7. Sufficient balance
    if (amountUsdt > usdtFree) {
      return reject(
        `Insufficient balance: need $${amountUsdt.toFixed(2)}, have $${usdtFree.toFixed(2)} free`,
      );
    }
  }

  return { allowed: true, warnings };
}

function reject(reason: string): GuardResult {
  return { allowed: false, reason, warnings: [] };
}
