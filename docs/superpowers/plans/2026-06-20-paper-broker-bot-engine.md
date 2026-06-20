# Paper Broker And Bot Engine Refactor Status

**Goal:** 本地 paper 交易层成为可持久化、可审计、支持 bot 资金分配和 USDT 线性合约的交易账户模拟层。

**Current architecture:** Paper mode is intentionally not a fake exchange. Public market data flows through `MarketDataProvider`; local execution/accounting flows through `PaperBroker`. Live mode still uses `LiveExchange` for real exchange execution.

**Tech stack:** TypeScript ESM, SQLite via `better-sqlite3`, CCXT public market data, Vitest.

---

## Implemented

- `src/market-data/types.ts` and `src/market-data/ccxt-provider.ts` define and implement public market data.
- `src/broker/types.ts`, `src/broker/symbols.ts`, and `src/broker/paper-broker.ts` define and implement the paper broker.
- `bot_allocations`, `paper_orders`, `paper_positions`, `paper_fills`, `strategy_mandates`, and `resident_agents` persist paper account and resident-agent state in SQLite.
- `buy`, `sell`, `open_position`, `close_position`, `get_portfolio`, `assess_risk`, and world snapshots use broker context in paper mode.
- `StrategyRuntime`, `RiskGate`, and `OrderExecutor` call `PaperBroker` directly in paper mode.
- `MarketFeed` consumes `MarketDataProvider` directly.
- Resident traders run in dedicated system sessions and are attributed as `resident_agent` with `agent_run_id`, `mandate_id`, and `capital_allocation_id`.
- Paper daemon startup seeds the active bot allocation from `INITIAL_BALANCE_USDT` only when no allocation row exists.

## Removed

- The in-memory `PaperExchange` implementation.
- The paper broker exchange adapter.
- The old `strategy_rules` table and migration path.
- SQLite identity backfill and column migration logic for old databases.
- Paper-mode fallback from broker execution to exchange execution.

## Current Scope Boundary

- Live spot execution remains on `LiveExchange`.
- Live contract execution is implemented as a thin exchange adapter path:
  live orders are sent to the exchange with contract params instead of local
  paper accounting. `CONTRACT_POSITION_MODE=auto` detects OKX account mode and
  maps order `positionSide` to `net` or `long`/`short`; it does not mutate the
  exchange account mode.
- Funding fees, automatic liquidation, and multi-daemon multi-bot scheduling are not implemented.
- Existing local SQLite databases from older schemas should be discarded or recreated before redeploying this branch.

## Verification Commands

```bash
npm run build
npm test
git diff --check
MEMORY_DB_PATH=<tmp>/smoke.db CRYPTO_AGENT_RUNTIME_DIR=<tmp> PAPER_TRADING=true INITIAL_BALANCE_USDT=2000 DEFAULT_EXCHANGE=okx timeout 6s npm run daemon
```
