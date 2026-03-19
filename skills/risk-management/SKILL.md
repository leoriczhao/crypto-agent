---
name: risk-management
description: Position sizing, stop-loss rules, portfolio risk limits, and capital preservation. Load before any trade execution or risk assessment.
---

# Risk Management Rules

## Position Sizing
- **Fixed fractional**: Risk max 1-2% of total portfolio per trade
- **Formula**: Position Size = (Portfolio × Risk%) / (Entry − Stop-Loss)
- **Example**: $10,000 portfolio, 2% risk, $100 entry, $95 stop
  - Size = ($10,000 × 0.02) / ($100 − $95) = $200 / $5 = 40 units

## Stop-Loss Rules

| Soul | Stop-Loss | Take-Profit | Risk:Reward |
|------|-----------|-------------|-------------|
| Conservative | 2-3% | 4-6% | 1:2 minimum |
| Balanced | 5% | 10-15% | 1:2 to 1:3 |
| Aggressive | 8-10% | 20%+ | 1:2 minimum |

Always set stop-loss BEFORE entering a trade. No exceptions.

## Portfolio Limits
- **Max single position**: 20% of portfolio (conservative: 10%)
- **Max total exposure**: 60% (keep 40% in USDT as dry powder)
- **Max correlated positions**: Don't hold BTC + ETH + SOL all long simultaneously — they correlate > 0.8 in downturns
- **Daily loss limit**: Stop trading for the day after 5% portfolio drawdown

## When to Reduce Exposure
- [ ] Portfolio down 10% from peak → Cut all positions by 50%
- [ ] Single asset down 20% in 24h → Exit or tighten stop to breakeven
- [ ] Funding rate > 0.1% → Market overheated, reduce longs
- [ ] BTC dominance rising + altcoins falling → Exit altcoins, hold BTC only

## Common Mistakes
1. **Revenge trading**: After a loss, wanting to "make it back" immediately
2. **No stop-loss**: "It'll come back" — the graveyard of portfolios
3. **Over-leveraging**: Even 2x can wipe you in crypto's volatility
4. **FOMO entries**: Buying after 30%+ pump — you're the exit liquidity
5. **Ignoring correlation**: "Diversified" portfolio of 5 altcoins = 1 position
