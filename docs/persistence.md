# Persistence Design

This document captures the persistence strategy for `crypto-agent`, what's
implemented, what's intentionally deferred, and the reasoning behind each
decision.

## Principle

A piece of state **must** be persisted iff losing it between crash and
restart causes any of:

1. Financial loss (forgotten stop-loss, duplicate order, missed exit)
2. Audit / compliance gap (missing trade record)
3. Risk control being bypassed (counters reset, limits forgotten)
4. Severe user-experience regression (lost conversation, reverted setting)

State that can be **rebuilt from external sources** (market data, exchange
API) is explicitly NOT persisted.

## What's stored (SQLite tables)

| Table | Purpose | Schema owner |
|-------|---------|--------------|
| `funding_accounts` | Capital owner / funding pool identity | `memory.ts` |
| `trading_accounts` | Executable exchange account identity | `memory.ts` |
| `trading_bots` | Trading bot identity bound to one trading account | `memory.ts` |
| `sessions` | Conversation session metadata + bot binding | `session.ts` / `memory.ts` |
| `conversations` | Chat history per session | `memory.ts` |
| `trades` | Filled trade audit log + bot/account attribution | `memory.ts` |
| `session_summaries` | Compacted context summaries | `memory.ts` |
| `cron_jobs` | Recurring LLM tasks | `memory.ts` |
| `events` | Generic event log | `memory.ts` |
| `strategy_rules` | Legacy rule entries, migrated into `strategies` | `memory.ts` |
| `risk_params` | StrategyManager risk parameters | `memory.ts` |
| `active_positions` (A0) | Fast-path positions + SL/TP + bot/account attribution | `memory.ts` / `executor.ts` |
| `daily_pnl` (A1) | Realized PnL per day | `memory.ts` / `risk-gate.ts` |
| `pending_orders` (A2) | Orders awaiting fill + bot/account attribution | `memory.ts` / buy & sell tools |
| `portfolio_watermark` (A3) | Peak portfolio value for drawdown | `memory.ts` / `risk-gate.ts` |
| `daemon_state` (B0) | KV for soul / exchange / session pointers | `memory.ts` / daemon & tools |
| `strategies` (B1) | Polymorphic strategy snapshots (`signal`, `ladder`, `grid`) + bot/account attribution | `memory.ts` / `strategy/manager.ts` |
| `strategy_kb` (C0) | Strategist research outcomes and failure reasons | `memory.ts` / KB tools |

## Restart reconciliation flow

1. `Memory` opens the SQLite DB (WAL mode is already on).
2. `CryptoDaemon.constructor()` → `restoreDaemonState()` applies saved
   `active_soul` / `active_exchange` / `active_user_session_id` from the
   `daemon_state` KV.
3. `ensureDefaultIdentity()` creates or refreshes the default funding account,
   trading account, and bot for the active exchange/mode, then backfills legacy
   rows whose bot/account columns are still NULL.
4. `StrategyManager.loadFromDb()` restores strategies + risk params.
5. `startFastPath()` → `OrderExecutor.restore()` loads `active_positions`
   and cross-checks with `exchange.fetchPositions()`:
   - **Match** → restore SL/TP into in-memory map.
   - **Local record, no exchange position** → drop (stale).
   - **Exchange position, no local record** → report as orphan; operator
     decides.
   - **Exchange unreachable** → keep local records; retry on the next
     evaluate.
6. `reconcilePendingOrders()` loads `status='open'` orders and compares
   against `exchange.fetchOpenOrders()`. Missing IDs → mark `filled`.
7. `HeartbeatScheduler.start()`.
8. `cronLoop()` begins.

## Implemented (Iteration 11)

### D0 — Account / bot / session identity
The persistence model now separates:

- `funding_accounts` — capital owner / funding pool
- `trading_accounts` — executable account scope (`exchange_id` + PAPER/LIVE mode)
- `trading_bots` — bot bound to a trading account
- `sessions.bot_id` — conversation context bound to a bot

Trade-bearing tables (`trades`, `pending_orders`, `active_positions`, and
`strategies`) carry `bot_id` and `trading_account_id` so audit rows are no
longer implicitly tied to the daemon-global `active_exchange`.

Current runtime scope is intentionally conservative: one daemon-active default
bot. Multi-bot concurrent execution is not implemented here.

### A0 — Active positions + SL/TP
Without this, a daemon restart loses knowledge of where our stops sit. The
exchange still holds the position, but the `OrderExecutor.monitorStopTakeProfit`
tick handler has no target levels, so adverse moves are not closed
automatically.

### A1 — Daily realized PnL
Closes the "restart resets the daily-loss cap" loophole. If a daemon crashes
mid-day with -4% realized, a fresh instance used to see `dailyPnl = 0` and
happily accept further losing trades until the full 5% cap was breached
starting from scratch. Now the cap is honored across restarts.

### A2 — Pending orders
Two-phase tracking: `createPendingOrder(status='open')` before sending,
`updatePendingOrder(status='filled')` after. On startup, the reconciliation
step checks each pending row against the exchange's open-orders list and
updates the status. Currently most orders are market-type (fill instantly),
but limit orders are now also tracked.

### A3 — Peak portfolio watermark
Drawdown is computed against the **peak** value seen, not the
config-declared initial balance. A $10k account that grew to $15k then
retraced to $11k has a 26.7% drawdown — previously this would have shown as
0% (since initial balance was $10k) and not triggered the 20% cap.

### B0 — Daemon state KV
Persists user-driven selections that env vars would otherwise overwrite on
restart:
- `active_soul` — survives `/switch_soul`
- `active_exchange` — survives `/switch_exchange`
- `active_user_session_id` — CLI reconnects to the right session
- `active_funding_account_id` / `active_trading_account_id` / `active_bot_id`
  — record the default identity selected for the active exchange

Implemented as a generic `daemon_state (key, value)` table so new
single-value state can be added without schema migrations.

### B1 — Polymorphic strategies
The `strategies` table stores `kind + params` snapshots for `signal`,
`ladder`, and `grid` strategies. Legacy `strategy_rules` rows are imported as
`kind='signal'` during migration so old rules continue to execute.

### B2 — Per-strategy budget isolation
Strategy allocation lives on the `strategies` row. Runtime accounting combines
`active_positions` and open `pending_orders` so a strategy cannot exceed its
allocated USDT by stacking live positions or resting entry orders.

### C0 — Strategy research KB
The strategist sub-agent records adopted, rejected, and pending hypotheses in
`strategy_kb`, including failure reasons. This makes failed research reusable
instead of letting the LLM repeat the same weak ideas.

## Deferred (explicitly NOT implemented yet)

Each entry below has been considered and rejected for **this** iteration.
Reasons and design sketches are preserved so we can pick them up later
without re-deriving them.

### A4 — Order-attempt ledger (two-phase commit)
**What**: Record *intent to send* before `createOrder`, update to
`sent` after the syscall, then `filled|failed` on response.

**Why deferred**: `pending_orders` (A2) already covers most of the surface
area. The remaining gap — crash between `createOrder` request and the
network ack — is caught by `reconcilePendingOrders()` via exchange lookup.
Adding an extra row for every order attempt doubles the write volume for
marginal coverage.

**When to revisit**: if we observe ambiguous cases in `pending_orders`
where `status='unknown'` entries are hard to diagnose.

**Sketch**:
```
CREATE TABLE order_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  amount REAL NOT NULL,
  price REAL,
  status TEXT NOT NULL,  -- 'requested' | 'sent' | 'filled' | 'failed'
  error TEXT,
  related_trade_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### B3 — TradeReviewer counter
**What**: `tradesSinceLastReview` — the counter that triggers automatic LLM
review every N trades.

**Why deferred**: Data-loss impact is trivially small (next review is
delayed by up to N-1 trades). Not a correctness or safety issue.

**Implementation**: would live in `daemon_state` as
`trades_since_last_review`. Bump on trade, read on startup.

### B4 — Heartbeat last-run metadata
**What**: Record the timestamp + textual result of the last heartbeat so
`/engine` or a new `/health` command can show "last check N minutes ago,
result: all clear".

**Why deferred**: Purely observational. Currently the `events` table and
journalctl cover the same information for operators willing to look.

**Implementation**: `daemon_state.last_heartbeat_at` + `.last_heartbeat_result`.

### B5 — LLM usage / cost tracking
**What**: Per-session token counts and cost estimates.

**Why deferred**: Operationally useful but not correctness-critical. All
three Claude/OpenAI responses include `usage.input_tokens` /
`usage.output_tokens`, so retrofitting is straightforward.

**Sketch**:
```
CREATE TABLE llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### B6 — Expanded event log
**What**: Record every slash command, every IPC client connect/disconnect,
every RiskGate decision (approved + rejected).

**Why deferred**: We already write `events` for high-signal items
(rejections, errors). Expanding without a UI to browse them is noise.

**When to revisit**: when we build a "history" view or a compliance export
feature.

### B7 — World snapshot history
**What**: Save the world-state snapshot the LLM sees at every invocation,
for post-hoc "why did it decide X?" analysis.

**Why deferred**: The snapshot is derived; storage grows linearly with
usage. For the current scale it's easier to re-run the query on historical
data if needed.

**Implementation when needed**:
```
CREATE TABLE world_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
Sampling frequency should be configurable — every-call is overkill for
most workflows.

## Intentionally NOT persisted

- `SignalStrategy` indicator caches — rebuilt in ~1s from
  `exchange.fetchOhlcv(..., 100)` on startup.
- `MarketFeed` subscriptions — recreated from active rules + restored
  positions.
- IPC client connections — clients auto-reconnect.
- In-flight LLM streams — caller sees an error on restart, retries.
- `Notifier` send history — idempotency would require exchange-side
  deduplication; not worth the complexity.
- Skill file contents — loaded from disk on demand.

## Invariants to preserve

1. **Exchange state is source of truth** for positions and open orders.
   Local tables carry *metadata* (SL/TP, session attribution) that the
   exchange doesn't know about. Reconciliation always prefers the
   exchange's view.
2. **Transactional writes for coupled state**. Position-creation logs
   a `trades` row AND a `pending_orders` row AND an `active_positions`
   row — future refactors should consider wrapping such multi-write
   sequences in a single SQLite transaction once the volume justifies it.
3. **UPSERT over blind INSERT** for singleton rows (`portfolio_watermark`,
   `daemon_state`, `daily_pnl`) so restarts don't fail on unique-key
   collisions.
4. **WAL mode stays on** (`journal_mode = WAL` in `memory.ts`). This is
   what makes the crash-safety guarantees above meaningful.
