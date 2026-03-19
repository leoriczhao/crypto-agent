---
name: trading-strategies
description: Crypto trading strategy playbook — entry/exit rules, position sizing, when to use each strategy. Load before recommending or executing trades.
---

# Trading Strategies Playbook

## SMA Crossover
- **Logic**: Buy when short SMA crosses above long SMA; sell on cross below
- **Best for**: Trending markets (BTC/ETH in bull runs)
- **Params**: short=10, long=30 for 1h; short=5, long=20 for 4h
- **Weakness**: Whipsaws in ranging markets — combine with ADX > 25 filter
- **Position size**: 10-15% of portfolio per signal

## RSI Reversal
- **Logic**: Buy when RSI < 30 (oversold); sell when RSI > 70 (overbought)
- **Best for**: Range-bound markets, mean reversion
- **Params**: period=14 standard; use 7 for more sensitivity on 15m/1h
- **Weakness**: Fails in strong trends (RSI can stay overbought for weeks)
- **Confirm with**: Volume spike on reversal, support/resistance levels

## Bollinger Bounce
- **Logic**: Buy at lower band touch; sell at upper band touch
- **Best for**: Low-volatility consolidation followed by expansion
- **Params**: period=20, std_dev=2.0 (standard); use 1.5 for tighter bands
- **Weakness**: Breakouts destroy this strategy — use with Bollinger Width filter

## Strategy Selection Matrix

| Market Condition | Best Strategy | Avoid |
|-----------------|---------------|-------|
| Strong uptrend | SMA Crossover | RSI Reversal (stays overbought) |
| Strong downtrend | SMA Crossover (short) | Bollinger Bounce |
| Ranging / Choppy | RSI Reversal | SMA Crossover (whipsaws) |
| Low volatility | Bollinger Bounce | All momentum strategies |
| High volatility | None — reduce size | Bollinger Bounce |
| News-driven | Manual only | All automated strategies |

## Multi-Strategy Combination
When 2+ strategies agree on direction, increase position size by 50%.
When strategies conflict, reduce size or stay flat.

## Backtest Before Live
Always run `backtest` tool with at least 200 candles before committing to a strategy.
Compare Sharpe ratio > 1.0 and win rate > 45% as minimum thresholds.
