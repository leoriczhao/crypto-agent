# Crypto Agent

LLM-driven crypto trading agent with real exchange integration.

```
Agent = LLM (OpenAI / Anthropic)
      + 17 atomic tools (market, trade, analysis, research, control)
      + Exchange abstraction (ccxt → OKX, Gate.io, Binance, ...)
      + Skills (on-demand domain knowledge)
      + Context compression (infinite sessions)
      + Sub-agents (researcher / trader / risk_officer)
      + Soul (conservative / balanced / aggressive personality)
      + Heartbeat + Cron + Memory + Telegram notifications
```

## Quick Start

```bash
git clone <this-repo>
cd crypto-agent
cp .env.example .env   # Edit: add your LLM API key + exchange credentials
uv sync
uv run crypto-agent    # Interactive CLI
uv run crypto-daemon   # Background daemon with heartbeat
```

## Architecture

```
User ─→ CLI (prompt_toolkit) ─→ Agent Loop ─→ LLM (GPT/Claude)
                                    │              │
                                    │        tool_use decision
                                    │              │
                                    ▼              ▼
                              Tool Dispatch ←── 17 tools
                                    │
                              Exchange Layer (ccxt)
                                    │
                              OKX / Gate.io / Binance ...
```

The LLM decides **what** to do. Tools execute **how**. The exchange layer handles **where**.

## Tools (17)

| Category | Tools | Purpose |
|----------|-------|---------|
| Market | `get_price`, `get_klines` | Price, OHLCV candles |
| Trade | `buy`, `sell`, `cancel_order` | Order execution |
| Portfolio | `get_portfolio` | Balances + positions + PnL |
| Analysis | `analyze`, `assess_risk`, `backtest` | TA indicators, risk, backtesting |
| Research | `get_news`, `get_chain_stats` | News sentiment, on-chain data |
| Control | `delegate`, `switch_exchange`, `switch_soul`, `schedule` | Sub-agents, config |
| Knowledge | `load_skill`, `compact` | Domain expertise, context management |

## Configuration (.env)

```bash
# LLM
LLM_PROVIDER=openai          # openai or anthropic
API_KEY=your-key
API_BASE_URL=                 # Optional proxy
MODEL_ID=gpt-5.4
LLM_CONTEXT_WINDOW=500000     # auto-compact threshold

# Exchange
DEFAULT_EXCHANGE=okx
EXCHANGE_API_KEY=...
EXCHANGE_SECRET=...
EXCHANGE_PASSWORD=...         # Required for OKX
PAPER_TRADING=true            # false for real trading

# Trading
MAX_ORDER_SIZE_USDT=1000
TRADING_SOUL=balanced         # conservative, balanced, aggressive

# Daemon
HEARTBEAT_INTERVAL=60
TELEGRAM_BOT_TOKEN=           # Optional
TELEGRAM_CHAT_ID=
```

## Testing

```bash
uv run pytest -v     # 77 tests
```

## License

MIT
