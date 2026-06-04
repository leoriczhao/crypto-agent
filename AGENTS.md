# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

LLM-powered crypto trading agent with paper/live trading via CCXT. Client-server architecture: a long-lived daemon holds all stateful components (agent, strategy engine, sessions) and exposes a Unix-socket IPC endpoint; one or more thin CLI clients attach to it. Supports OpenAI and Anthropic as LLM providers.

## Commands

```bash
npm run build          # TypeScript → dist/
npm run daemon         # Start the daemon (foreground, blocks terminal)
npm run dev:daemon     # Alias for `daemon`
npm run dev            # Start a CLI client (connects to running daemon)
npm test               # Vitest (230+ tests, 15s timeout)
npm run test:watch     # Watch mode
npx vitest run test/tools.test.ts              # Single test file
npx vitest run test/tools.test.ts -t "buy"     # Single test by name
```

**Typical workflow**: run `npm run daemon` in one terminal, `npm run dev` in another. Multiple CLI clients can attach to the same daemon concurrently.

**Production (user-level systemd)**: `npm run install:service` generates `~/.config/systemd/user/crypto-agent.service` from `systemd/crypto-agent.service.template` (substitutes the actual node binary path so nvm installs work) and enables it. Use `systemctl --user {start,stop,restart,status} crypto-agent` thereafter. `npm run uninstall:service` removes it. Logs go to `~/.local/state/crypto-agent/`.

## Architecture

### Client-Server Split (two processes)

- **Daemon** (`src/daemon.ts`) — long-running, headless (no REPL). Holds the single `CryptoAgent` + `StrategyManager` + `StrategyRuntime` + `HeartbeatScheduler` + cron + `SessionManager`. Writes logs to stderr. PID-locked via `src/ipc/lockfile.ts` (prevents double-start).
- **CLI** (`src/cli.ts`) — Ink client. Connects to daemon's Unix socket, sends user input, renders streaming LLM output + broadcast events (auto-trades, heartbeat, review). Auto-reconnects if daemon restarts.
- **IPC** (`src/ipc/`) — JSONL over Unix-domain socket at `${XDG_RUNTIME_DIR || /tmp}/crypto-agent-${uid}.sock`. Override with `CRYPTO_AGENT_SOCK` env var. Protocol defined in `src/ipc/protocol.ts` as a discriminated union of `ClientMessage` / `ServerMessage`. Chat requests are cancellable: the client sends `cancel` for the request id, the server aborts the request's `AbortController`, and the provider stream is stopped.

### Two Execution Paths (inside the daemon)

1. **LLM-driven** — Client sends `{type: "chat", session, content}` → daemon's `CryptoAgent.chatInSession()` runs the LLM loop → streaming `delta` / `tool_use` / `done` messages flow back over IPC.

2. **Fast path** — Strategy objects evaluate ticks/candles with zero LLM latency. Pipeline: `MarketFeed` → `StrategyRuntime` / `Strategy` → `RiskGate` → `OrderExecutor`. Strategies are created by the LLM via `plan_strategy`, `plan_ladder_strategy`, or `plan_grid_strategy` tools but execute autonomously. Events from this path are broadcast as `{type: "event"}` to all attached CLIs.

### Key Abstractions

- **Tool registry** (`src/tools/registry.ts`): `registerTool(name, description, schema, deps, handler)` populates `TOOL_DEFINITIONS[]`, `TOOL_HANDLERS{}`, and `TOOL_DEPS{}`. Each tool declares its injected dependencies (e.g., `["exchange", "config", "memory"]`). `dispatchTool()` in `agent.ts` auto-resolves deps from a map — no per-tool if/else branching. New tools only need to declare deps, not modify the agent.

- **Exchange abstraction** (`src/exchange/base.ts`): `BaseExchange` interface with `LiveExchange` (CCXT wrapper) and `PaperExchange` (simulated fills, real market data). `ExchangeManager` holds a registry of named exchanges and an active pointer. Paper mode delegates price fetches to a real CCXT instance but simulates order fills in memory.

- **Soul** (`src/soul.ts`): Trading personality (conservative/balanced/aggressive) injected into the LLM system prompt. Soul numerical params (`max_position_pct`, `stop_loss_pct`) are **enforced in code** by `trade-guard.ts` — not just prompt suggestions. Switchable at runtime.

- **Trade guard** (`src/trade-guard.ts`): Unified risk gate for LLM-driven trades. `checkTradeAllowed()` enforces: max order size, soul position limits, 60% total exposure cap, 20% drawdown halt, and balance sufficiency. Called by buy/sell tool handlers before every order. Sells skip position/exposure checks (they reduce exposure).

- **Trade lock** (`src/trade-lock.ts`): Global `AsyncMutex` singleton (`tradeLock`) that serializes every risk-check + order-placement critical section. Both buy/sell tools (slow path) and `OrderExecutor.handleSignal()` + stop-loss/take-profit exits (fast path) acquire it via `withTradeLock(label, fn)`. Guarantees that concurrent sessions or LLM-vs-fast-path paths never race on the same account.

- **World snapshot** (`src/world-snapshot.ts`): Builds a concise portfolio/positions/rules summary injected into the system prompt before each LLM call. Eliminates the need for the LLM to call `get_portfolio` at the start of every turn, reducing round-trips. Controlled by `WORLD_SNAPSHOT_ENABLED` config flag.

- **Strategy runtime** (`src/strategy/manager.ts`, `src/strategy/runtime.ts`, `src/strategy/base.ts`): `StrategyManager` persists polymorphic strategy snapshots and builds concrete `signal`, `ladder`, and `grid` strategies. `StrategyRuntime` starts/stops strategies, wires market subscriptions, forwards strategy signals to `OrderExecutor`, and routes fills back into strategy state.

- **Shared evaluator** (`src/strategy/evaluator.ts`): Condition evaluation functions (`evalCondition`, `computeIndicatorValue`, `checkCross*`) used by both `SignalStrategy` (live) and `BacktestEngine` (historical). Ensures condition-based backtests match live execution. Supports indicator caching — `updateCachedIndicators()` computes RSI/SMA/Bollinger once per candle, tick evaluation uses cached values.

- **Context compression** (`src/context.ts`): Two layers — micro-compact (client-side, replaces old tool results with placeholders) and auto-compact (LLM-generated summary when token estimate exceeds threshold).

- **Sub-agents** (`src/sub-agents.ts`): Specialized roles (researcher/trader/risk_officer/strategist) with restricted tool subsets. The strategist role can run a longer research loop: search KB, gather market data, backtest, create or reject a strategy, and log the result.

- **Strategies** (`src/strategy/`): `SignalStrategy` uses entry/exit `Condition[]` arrays (indicator + operator + value). `LadderStrategy` scales into positions across price levels and exits on combined weighted-average TP/SL. `GridStrategy` maintains long-only resting limit buys and follow-up sells across a configured range. The `backtest` tool supports `entry_conditions`/`exit_conditions` arrays that use the same evaluator as live signal strategies.

### Persistence

SQLite via `better-sqlite3` (`src/memory.ts`). Tables include the original chat/trade/rule tables plus crash-recovery tables added in Iteration 11:

- `active_positions` — local SL/TP metadata for the fast-path executor. On startup, `OrderExecutor.restore()` reconciles with `exchange.fetchPositions()`.
- `daily_pnl` — cumulative realized PnL per day; closes the "restart resets the daily-loss cap" loophole.
- `pending_orders` — two-phase tracking for order placement; reconciled against `exchange.fetchOpenOrders()` on startup.
- `portfolio_watermark` — peak portfolio value so drawdown is computed against the high-water mark, not the static initial balance.
- `daemon_state` — KV store for `active_soul` / `active_exchange` / `active_user_session_id` so user-driven settings survive restart.
- `strategies` — polymorphic strategy snapshots (`signal`, `ladder`, `grid`), replacing legacy rule-only storage.
- `strategy_kb` — strategist research outcomes, including rejected hypotheses and failure reasons.

Full design, including the items intentionally deferred to future iterations (A4 order-attempt ledger, B2–B6 observability), is in `docs/persistence.md`.

### LLM Provider Abstraction

`src/llm/provider.ts` exports kwargs builders for both OpenAI and Anthropic APIs. Provider selection is config-driven (`LLM_PROVIDER` env var). The agent class (`src/agent.ts`) maintains separate streaming methods: `streamOpenai()` and `streamAnthropic()`.

### Daemon Extras

- **Heartbeat** (`src/heartbeat.ts`): periodic LLM health-check loop (configurable interval)
- **Cron jobs**: checked every 30s, executed via `agent.chatInSession()` on a system session
- **Telegram notifications** (`src/notify.ts`): optional alerting
- **Slash commands** (handled by daemon, invoked from CLI): `/new`, `/switch`, `/sessions`, `/compact`, `/trades`, `/rules`, `/budget`, `/risk`, `/engine`, `/research`, `/kb`. Implementations are in `CryptoDaemon.handleSlashCommand()` in `src/daemon.ts`.
- **Event broadcast**: auto-trade entries/exits, heartbeat results, and trade reviews are pushed to all attached CLIs as `{type: "event"}` messages via `IpcServer.broadcast()`.

## Configuration

All config via `.env` (see `.env.example`). Key variables:
- `LLM_PROVIDER` (openai/anthropic), `API_KEY`, `MODEL_ID`, `API_BASE_URL` (for third-party proxies)
- `DEFAULT_EXCHANGE`, `EXCHANGE_API_KEY`, `EXCHANGE_SECRET`, `EXCHANGE_PASSWORD` (OKX passphrase)
- `PAPER_TRADING` (true/false), `TRADING_SOUL` (conservative/balanced/aggressive)
- `EXTRA_EXCHANGES` — JSON string for multi-exchange setup
- `WORLD_SNAPSHOT_ENABLED` — inject current state into system prompt (default true)

### IPC paths

- Socket: `${XDG_RUNTIME_DIR || /tmp}/crypto-agent-${uid}.sock`
- PID file: `${XDG_RUNTIME_DIR || /tmp}/crypto-agent-${uid}.pid`
- Overrides: `CRYPTO_AGENT_SOCK`, `CRYPTO_AGENT_PID`, `CRYPTO_AGENT_RUNTIME_DIR`

## Conventions

- ESM throughout (`"type": "module"` in package.json). All local imports use `.js` extensions.
- Strict TypeScript. Target ES2022, module NodeNext.
- Symbols always in `BASE/QUOTE` format (e.g., `BTC/USDT`).
- Positions keyed as `symbol:side` to support hedge mode (dual-direction).
- Skills (domain knowledge) are markdown files in `skills/*/SKILL.md` with YAML frontmatter.
- Tests in `test/` directory, one test file per module. Tests use Vitest with no external services (paper exchange, in-memory SQLite).
