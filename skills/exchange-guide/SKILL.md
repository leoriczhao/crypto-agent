---
name: exchange-guide
description: Exchange-specific trading rules, fee structures, and API quirks. Load when dealing with exchange-specific issues or comparing exchanges.
---

# Exchange Guide

## Gate.io
- **Maker fee**: 0.2% (VIP0), reducible to 0.055% with GT token
- **Taker fee**: 0.2% (VIP0)
- **Symbols**: Use format `BTC/USDT`, `ETH/USDT`
- **Min order**: Varies by pair, typically $1-5 USDT equivalent
- **API quirks**:
  - Rate limit: 900 req/10s for public, 900 req/10s for private
  - Futures and spot are separate API endpoints
  - Withdrawal requires IP whitelist for API keys

## OKX
- **Maker fee**: 0.08% (VIP0), **Taker fee**: 0.1%
- **Password**: Required for API access (set when creating API key)
- **API quirks**:
  - Requires `password` in addition to api_key and secret
  - Unified account — spot, margin, futures in one balance
  - Rate limit: 20 req/2s per endpoint

## Bybit
- **Maker fee**: 0.1%, **Taker fee**: 0.1%
- **API quirks**:
  - Unified Trading Account (UTA) merges all products
  - Rate limit: 120 req/5s for order placement

## Binance
- **Maker fee**: 0.1%, **Taker fee**: 0.1% (reducible with BNB)
- **Note**: Not accessible from mainland China without VPN
- **API quirks**:
  - Most liquid exchange globally
  - IP whitelist recommended for API security

## Fee Optimization Tips
1. Use maker orders (limit) instead of taker (market) when possible
2. Hold exchange tokens (GT, BNB) for fee discounts
3. For frequent trading, compare total fee impact: 0.1% difference on $10K daily volume = $10/day
4. Factor in withdrawal fees when choosing exchange

## Cross-Exchange Arbitrage
Use `exchange_manage` tool's status action to compare BTC prices across exchanges.
Profitable only when spread > total fees (both sides) + slippage (~0.5% minimum).
