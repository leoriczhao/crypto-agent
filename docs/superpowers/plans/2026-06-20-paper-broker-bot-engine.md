# Paper Broker And Bot Engine Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全本地 paper 交易层，让它成为可持久化、可审计、支持 bot 资金分配和 USDT 线性合约的交易账户模拟层；同时保留现有策略算法、`StrategyRuntime`、`OrderExecutor` 主流程和工具注册机制的兼容面。

## Implementation Status

Implemented on 2026-06-20:

- Added the `MarketDataProvider` and `Broker` boundaries, with public CCXT market data separated from local paper execution.
- Added a persistent SQLite-backed `PaperBroker` for bot allocation, paper orders, paper positions, fills, spot balances, and isolated USDT linear paper contracts.
- Added `BrokerExchangeAdapter` so existing spot tools, `RiskGate`, `StrategyRuntime`, and `OrderExecutor` continue consuming a `BaseExchange`-compatible object.
- Wired paper daemon startup to seed the active bot allocation from `INITIAL_BALANCE_USDT` without resetting existing allocation rows.
- Added `open_position`, `close_position`, and `llm_trader_job`; scheduled trader jobs run in dedicated system sessions and paper orders from those sessions are attributed as `llm_trader`.
- Updated `buy`, `sell`, `get_portfolio`, and world snapshot behavior to use the broker context and show active bot allocation when available.
- Documented paper broker persistence and paper-specific environment variables.

Verified:

```bash
npm run build && npm test
git diff --check
MEMORY_DB_PATH=<tmp>/smoke.db CRYPTO_AGENT_RUNTIME_DIR=<tmp> PAPER_TRADING=true INITIAL_BALANCE_USDT=2000 DEFAULT_EXCHANGE=okx timeout 6s npm run daemon
```

Current scope boundary: live exchange execution is intentionally still on the existing `LiveExchange` path; live contract trading, funding fees, automatic liquidation, and multi-daemon multi-bot scheduling remain outside this first implementation.

**Architecture:** 这不是再换一次 agent 框架。当前缺口在交易账户语义：`funding_accounts -> trading_accounts -> trading_bots -> sessions` 已经能标记归属，但 bot 还没有真正的资金钱包，paper 订单/余额/仓位也还只是进程内状态。重构后：

- `MarketDataProvider` 只负责公共行情；paper 模式看行情不需要交易 API key。
- `Broker` 负责账户、订单、持仓、成交、保证金和审计。
- `PaperBroker` 用 SQLite 保存本地 paper 账户状态，不向交易所下单。
- `BrokerExchangeAdapter` 实现当前 `BaseExchange` 接口，让现有 `buy/sell/get_portfolio`、`RiskGate`、`OrderExecutor` 先不用整体改写。
- bot 的资金分配先落为默认 active bot 的真实 paper allocation；多 bot 并发 runtime 后续在同一模型上扩展。

**Tech Stack:** TypeScript ESM, SQLite via `better-sqlite3`, CCXT public market data, existing daemon/IPC/tool/strategy stack, Vitest.

---

## Non-Goals

- 不改 `SignalStrategy`、`GridStrategy`、`LadderStrategy` 的交易算法。
- 不改 `StrategyRuntime` 的信号分发模型。
- 不把 live 交易迁移到新 broker；live 先继续走 `LiveExchange` 或兼容包装。
- 不在第一阶段实现真实交易所合约下单、资金费率扣收、强平撮合或多 daemon 多 bot 调度。
- 不把 LangGraph agent 层再重构一遍。

## Target Model

### 账户关系

```text
FundingAccount
  owns capital pool, e.g. default-funding USDT
    -> TradingAccount
       executable account scope: exchange_id + PAPER/LIVE + market permissions
         -> TradingBot
            owns an allocation inside that trading account
              -> Session
                 human or LLM conversation context
              -> Strategy
                 autonomous fast-path bot behavior
              -> LlmTraderJob
                 scheduled human-like trader behavior
```

### 两种运行方式

1. **策略 bot**
   - LLM 创建或调整 bot、资金分配和策略。
   - `StrategyRuntime` 监听行情并发出 `Signal`。
   - `OrderExecutor` 通过 `BrokerExchangeAdapter` 进入 broker。
   - broker 负责 paper 订单、余额、持仓和成交落库。

2. **LLM 实时交易员**
   - CLI 或 cron/job 触发 agent 会话。
   - LLM 使用工具直接开仓、平仓、查组合，也可以创建/调整 bot 和策略。
   - 直接交易和策略交易共享同一个 broker、risk gate 和 trade lock。

---

## Files

- Add: `src/market-data/types.ts`
  - Define `MarketDataProvider`.
- Add: `src/market-data/ccxt-provider.ts`
  - Public CCXT market data implementation.
- Add: `src/broker/types.ts`
  - Define `Broker`, order request/result, account snapshot, paper position, fill event, actor context.
- Add: `src/broker/paper-broker.ts`
  - Persistent local paper broker for spot and USDT linear swaps.
- Add: `src/broker/exchange-adapter.ts`
  - Implements existing `BaseExchange` on top of `MarketDataProvider + Broker`.
- Add: `src/broker/symbols.ts`
  - Normalize spot symbols and USDT swap symbols.
- Modify: `src/memory.ts`
  - Add paper account, allocation, order, position, fill persistence helpers.
- Modify: `src/exchange/paper.ts`
  - Keep current in-memory implementation as a compatibility class for existing tests and non-daemon use.
- Modify: `src/agent.ts`
  - Add a daemon-only way to replace the default paper exchange with a persistent broker adapter after `Memory` and identity are available.
- Modify: `src/daemon.ts`
  - Wire persistent paper broker after `ensureDefaultIdentity()`.
  - Seed active bot allocation from `INITIAL_BALANCE_USDT` only when no paper allocation exists.
  - Keep fast path initialization consuming a `BaseExchange`-compatible object.
- Modify: `src/tools/buy.ts`, `src/tools/sell.ts`, `src/tools/get-portfolio.ts`
  - Keep current behavior through adapter; add actor/bot attribution where available.
- Modify: `src/agent/tool-dispatch.ts`, `src/tools/registry.ts`
  - Add an optional `broker` dependency for contract-aware tools while preserving existing `exchange` dependency resolution.
- Add: `src/tools/open-position.ts`
  - Contract-aware direct trade tool for long/short paper positions.
- Add: `src/tools/close-position.ts`
  - Close paper positions by symbol/side/amount or full close.
- Modify: `src/tools/index.ts`
  - Register new contract-aware tools.
- Modify: `src/tools/plan-strategy.ts`, `src/tools/plan-grid-strategy.ts`, `src/tools/plan-ladder-strategy.ts`
  - Ensure created strategies inherit active bot/account and cannot allocate more than bot free allocation.
- Modify: `src/world-snapshot.ts`
  - Show bot allocation, paper equity, margin, positions, open orders.
- Modify: `docs/persistence.md`
  - Document paper broker tables and restart semantics.
- Test: `test/paper-broker.test.ts`
- Test: `test/broker-exchange-adapter.test.ts`
- Test: `test/paper-contracts.test.ts`
- Modify tests: `test/paper-exchange-limit.test.ts`, `test/grid-e2e.test.ts`, `test/executor-restore.test.ts`, `test/tools.test.ts`, `test/world-snapshot.test.ts`, `test/persistence.test.ts`

---

## Task 1: Characterize Current Trading Boundaries

**Files:**
- Test: `test/broker-exchange-adapter.test.ts`
- Test: `test/paper-broker.test.ts`

- [ ] **Step 1: Add adapter contract tests before implementation**

Create tests that describe the compatibility surface the old trading layer expects:

- `fetchTicker(symbol)` delegates to market data.
- `fetchOhlcv(symbol, timeframe, limit)` delegates to market data.
- `fetchOrderBook(symbol, limit)` delegates to market data.
- `createOrder()` returns `{ id, symbol, side, type, amount, price, status }`.
- `fetchBalance()` returns CCXT-like `{ USDT: { free, used, total } }`.
- `fetchPositions()` returns keys compatible with current executor restore logic: `symbol` and `symbol:side`.
- `fetchOpenOrders(symbol?)` returns open orders.
- `cancelOrder(orderId, symbol)` cancels only open orders.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
npx vitest run test/broker-exchange-adapter.test.ts test/paper-broker.test.ts
```

Expected: FAIL because `src/broker/*` does not exist yet.

---

## Task 2: Add Market Data And Broker Interfaces

**Files:**
- Add: `src/market-data/types.ts`
- Add: `src/market-data/ccxt-provider.ts`
- Add: `src/broker/types.ts`
- Add: `src/broker/symbols.ts`

- [ ] **Step 1: Define market data boundary**

Create `MarketDataProvider`:

```ts
export interface MarketDataProvider {
  readonly exchangeId: string;
  fetchTicker(symbol: string): Promise<{ symbol: string; last: number; bid?: number; ask?: number; volume?: number; timestamp: number }>;
  fetchOhlcv(symbol: string, timeframe?: string, limit?: number): Promise<Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>>;
  fetchOrderBook(symbol: string, limit?: number): Promise<{ bids: Array<[number, number]>; asks: Array<[number, number]> }>;
  close?(): Promise<void>;
}
```

- [ ] **Step 2: Define broker boundary**

Create `Broker` with no LLM or strategy dependencies:

```ts
export interface Broker {
  readonly tradingAccountId: string;
  readonly mode: "PAPER" | "LIVE";
  createOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult>;
  cancelOrder(orderId: string, symbol: string): Promise<BrokerOrderResult>;
  fetchBalance(botId?: string): Promise<Record<string, { free: number; used: number; total: number }>>;
  fetchPositions(botId?: string): Promise<Record<string, BrokerPosition>>;
  fetchOpenOrders(symbol?: string | null, botId?: string): Promise<BrokerOrderResult[]>;
  markToMarket(symbol: string, markPrice: number): Promise<void>;
}
```

`BrokerOrderRequest` must include:

- `symbol`
- `marketType: "spot" | "swap"`
- `side: "buy" | "sell"`
- `positionSide?: "long" | "short"`
- `orderType: "market" | "limit"`
- `amount`
- `price?: number | null`
- `notionalUsdt?: number`
- `leverage?: number`
- `reduceOnly?: boolean`
- `actorType: "session" | "strategy" | "llm_trader" | "system"`
- `actorId?: string | null`
- `botId`
- `tradingAccountId`

- [ ] **Step 3: Add symbol normalization**

Implement:

- `normalizeSpotSymbol("BTC/USDT") -> { base: "BTC", quote: "USDT", marketType: "spot" }`
- `normalizeSwapSymbol("BTC/USDT:USDT") -> { base: "BTC", quote: "USDT", settle: "USDT", marketType: "swap" }`
- Reject unsupported quote/settle in paper contracts for now except USDT.

- [ ] **Step 4: Verify typecheck**

Run:

```bash
npm run build
```

Expected: PASS after exported types compile.

---

## Task 3: Add Persistent Paper Store

**Files:**
- Modify: `src/memory.ts`
- Modify: `test/persistence.test.ts`
- Add: `test/paper-broker.test.ts`

- [ ] **Step 1: Add failing persistence tests**

Test a fresh DB can:

- seed a bot allocation once,
- reopen without resetting balances,
- persist open orders,
- persist spot balances,
- persist swap positions,
- persist fills with actor and bot attribution.

Run:

```bash
npx vitest run test/persistence.test.ts test/paper-broker.test.ts -t "paper"
```

Expected: FAIL because tables/helpers do not exist.

- [ ] **Step 2: Add minimal tables**

Add idempotent schema creation and migrations:

```sql
CREATE TABLE IF NOT EXISTS bot_allocations (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  trading_account_id TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDT',
  allocated REAL NOT NULL,
  free REAL NOT NULL,
  used REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id TEXT PRIMARY KEY,
  trading_account_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL,
  position_side TEXT,
  order_type TEXT NOT NULL,
  amount REAL NOT NULL,
  price REAL,
  leverage REAL,
  reduce_only INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  filled_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paper_positions (
  id TEXT PRIMARY KEY,
  trading_account_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL,
  position_side TEXT NOT NULL,
  amount REAL NOT NULL,
  avg_entry_price REAL NOT NULL,
  mark_price REAL NOT NULL,
  leverage REAL NOT NULL DEFAULT 1,
  margin_usdt REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paper_fills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  trading_account_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL,
  position_side TEXT,
  amount REAL NOT NULL,
  price REAL NOT NULL,
  fee_usdt REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 3: Add Memory helpers**

Add methods:

- `ensureBotAllocation(input: { botId: string; tradingAccountId: string; asset: string; amount: number }): BotAllocationRow`
- `getBotAllocation(botId: string, tradingAccountId: string, asset: string): BotAllocationRow | null`
- `updateBotAllocation(input: { botId: string; tradingAccountId: string; asset: string; freeDelta?: number; usedDelta?: number; realizedPnlDelta?: number }): void`
- `createPaperOrder(input: PaperOrderInsert): PaperOrderRow`
- `updatePaperOrder(id: string, patch: { status?: string; filledAt?: string | null; price?: number | null }): void`
- `listPaperOpenOrders(input: { tradingAccountId: string; botId?: string; symbol?: string | null }): PaperOrderRow[]`
- `upsertPaperPosition(input: PaperPositionRow): void`
- `deletePaperPosition(id: string): void`
- `listPaperPositions(input: { tradingAccountId: string; botId?: string; symbol?: string | null }): PaperPositionRow[]`
- `insertPaperFill(input: PaperFillInsert): number`

- [ ] **Step 4: Verify persistence**

Run:

```bash
npx vitest run test/persistence.test.ts test/paper-broker.test.ts -t "paper"
```

Expected: PASS.

---

## Task 4: Implement Persistent Spot Paper Broker

**Files:**
- Add: `src/broker/paper-broker.ts`
- Add: `src/broker/exchange-adapter.ts`
- Modify: `src/exchange/paper.ts`
- Test: `test/paper-broker.test.ts`
- Test: `test/broker-exchange-adapter.test.ts`
- Modify: `test/paper-exchange-limit.test.ts`

- [ ] **Step 1: Add failing broker behavior tests**

Test:

- market spot buy debits USDT allocation and credits base asset position/balance,
- market spot sell requires base asset and credits USDT,
- limit buy rests open and fills on `markToMarket`,
- limit sell rests open and fills on `markToMarket`,
- insufficient funds at fill time cancels with a reason,
- restart reloads open orders and balances from DB.

Run:

```bash
npx vitest run test/paper-broker.test.ts test/broker-exchange-adapter.test.ts test/paper-exchange-limit.test.ts
```

Expected: FAIL until broker implementation exists.

- [ ] **Step 2: Implement `PaperBroker` spot path**

Rules:

- market order fills at `MarketDataProvider.fetchTicker(symbol).last`.
- limit buy fills when `markPrice <= limitPrice`.
- limit sell fills when `markPrice >= limitPrice`.
- no exchange API key is used.
- order IDs are generated locally.
- every fill writes `paper_fills`.
- every order writes `paper_orders`.
- every balance change updates `bot_allocations`.
- spot positions remain compatible with current `fetchPositions()` shape.

- [ ] **Step 3: Implement `BrokerExchangeAdapter`**

Adapter mapping:

- `fetchTicker/fetchOhlcv/fetchOrderBook` -> `MarketDataProvider`
- `createOrder(symbol, side, type, amount, price)` -> `broker.createOrder({ symbol, side, orderType: type, amount, price, marketType: "spot", actorType: "system", actorId: null, botId: activeBotId, tradingAccountId })`
- `fetchBalance()` -> `broker.fetchBalance(activeBotId)`
- `fetchPositions()` -> `broker.fetchPositions(activeBotId)`
- `fetchOpenOrders(symbol?)` -> `broker.fetchOpenOrders(symbol, activeBotId)`
- `cancelOrder(orderId, symbol)` -> `broker.cancelOrder(orderId, symbol)`
- `processTick(symbol, last)` -> `broker.markToMarket(symbol, last)`

- [ ] **Step 4: Keep old `PaperExchange` tests passing**

Make `PaperExchange` a compatibility wrapper:

- existing constructor path keeps the in-memory behavior used by old tests,
- daemon construction path bypasses `PaperExchange` and registers `BrokerExchangeAdapter`,
- no old test should need to understand `PaperBroker`.

- [ ] **Step 5: Verify focused tests**

Run:

```bash
npx vitest run test/paper-broker.test.ts test/broker-exchange-adapter.test.ts test/paper-exchange-limit.test.ts
```

Expected: PASS.

---

## Task 5: Add Paper USDT Linear Contract Support

**Files:**
- Modify: `src/broker/paper-broker.ts`
- Modify: `src/broker/symbols.ts`
- Add: `test/paper-contracts.test.ts`

- [ ] **Step 1: Add failing contract tests**

Test:

- open long `BTC/USDT:USDT` with `notionalUsdt=200`, `leverage=5` uses `40 USDT` margin.
- open short `ETH/USDT:USDT` with `notionalUsdt=100`, `leverage=3` uses `33.3333 USDT` margin.
- mark price updates unrealized PnL:
  - long PnL = `(mark - entry) * amount`
  - short PnL = `(entry - mark) * amount`
- closing a long releases margin and realizes PnL.
- closing a short releases margin and realizes PnL.
- reducing more than current position is rejected.
- restart preserves contract positions and PnL recalculates from latest mark.

Run:

```bash
npx vitest run test/paper-contracts.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement contract order semantics**

Paper simplifications for first implementation:

- USDT linear only.
- Isolated margin only.
- One position per `bot_id + trading_account_id + symbol + position_side`.
- Funding fee is recorded as zero.
- Liquidation is not executed automatically; expose estimated liquidation warning only.
- Fees default to zero unless `PAPER_TAKER_FEE_BPS` or `PAPER_MAKER_FEE_BPS` is configured later.

- [ ] **Step 3: Verify contract tests**

Run:

```bash
npx vitest run test/paper-contracts.test.ts
```

Expected: PASS.

---

## Task 6: Wire Persistent Paper Broker Into The Daemon

**Files:**
- Modify: `src/agent.ts`
- Modify: `src/daemon.ts`
- Modify: `src/config.ts`
- Modify: `test/ipc-e2e.test.ts`
- Modify: `test/world-snapshot.test.ts`

- [ ] **Step 1: Add daemon construction seam**

Add a method on `CryptoAgent`:

```ts
configurePaperBroker(opts: {
  memory: Memory;
  identity: DefaultIdentity;
  initialBalance: Record<string, number>;
  httpsProxy?: string;
}): void
```

It should replace the active paper exchange with `BrokerExchangeAdapter`.

- [ ] **Step 2: Seed allocation in daemon**

After `ensureDefaultIdentity()`:

- call `agent.configurePaperBroker({ memory, identity: this.activeIdentity, initialBalance: config.initialBalance, httpsProxy: config.httpsProxy })` only in paper mode.
- call `memory.ensureBotAllocation({ botId: identity.bot.id, tradingAccountId: identity.tradingAccount.id, asset: "USDT", amount: config.initialBalance.USDT ?? 10000 })` for the active bot.
- do not reset allocation if rows already exist.
- keep `LiveExchange` path unchanged in live mode.

- [ ] **Step 3: Keep fast path unchanged at the call site**

`initFastPath()` should still see a `BaseExchange`-compatible object:

- `BrokerExchangeAdapter.ccxtInstance` returns the `CcxtMarketDataProvider`'s CCXT instance so `MarketFeed` construction stays unchanged.
- `RiskGate` receives the adapter.
- `StrategyRuntime` receives the adapter.
- `OrderExecutor` receives the adapter.

- [ ] **Step 4: Verify daemon-facing tests**

Run:

```bash
npx vitest run test/ipc-e2e.test.ts test/world-snapshot.test.ts test/grid-e2e.test.ts test/executor-restore.test.ts
```

Expected: PASS.

---

## Task 7: Add Bot Allocation Enforcement

**Files:**
- Modify: `src/memory.ts`
- Modify: `src/strategy/manager.ts`
- Modify: `src/strategy/risk-gate.ts`
- Modify: `src/trade-guard.ts`
- Modify: `src/tools/plan-strategy.ts`
- Modify: `src/tools/plan-grid-strategy.ts`
- Modify: `src/tools/plan-ladder-strategy.ts`
- Modify: `test/trade-guard.test.ts`
- Modify: `test/grid-e2e.test.ts`
- Modify: `test/tools.test.ts`

- [ ] **Step 1: Add failing allocation tests**

Test:

- a strategy cannot allocate more than active bot free USDT,
- a grid cannot stack resting entries beyond strategy allocation,
- direct LLM trades consume active bot free allocation,
- closed profitable contract updates bot realized PnL and free equity,
- existing `allocated_usdt` strategy budget behavior still works.

Run:

```bash
npx vitest run test/trade-guard.test.ts test/grid-e2e.test.ts test/tools.test.ts -t "allocation|budget|bot"
```

Expected: FAIL for new bot allocation checks.

- [ ] **Step 2: Extend risk context**

Add bot-level values to `TradeGuardContext`:

- `botAllocatedUsdt`
- `botFreeUsdt`
- `botUsedUsdt`
- `marketType`
- `leverage`
- `marginRequiredUsdt`

Keep existing strategy budget fields for per-strategy isolation.

- [ ] **Step 3: Enforce bot allocation before order placement**

Rules:

- spot buy consumes quote free balance.
- swap open consumes margin, not full notional.
- swap reduce-only close releases margin and applies PnL.
- direct LLM trades without strategy still cannot exceed active bot free allocation.
- sells/reduce-only closes are allowed when they reduce exposure.

- [ ] **Step 4: Verify allocation tests**

Run:

```bash
npx vitest run test/trade-guard.test.ts test/grid-e2e.test.ts test/tools.test.ts -t "allocation|budget|bot"
```

Expected: PASS.

---

## Task 8: Add Contract-Aware Direct Trading Tools

**Files:**
- Add: `src/tools/open-position.ts`
- Add: `src/tools/close-position.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/tools/get-portfolio.ts`
- Modify: `src/agent.ts`
- Modify: `src/agent/tool-dispatch.ts`
- Modify: `src/tools/registry.ts`
- Modify: `test/tools.test.ts`

- [ ] **Step 1: Add failing tool tests**

Test:

- `open_position` opens paper long/short contract positions.
- `open_position` accepts `symbol`, `side`, `notional_usdt`, `leverage`, `order_type`, optional `price`.
- `close_position` closes full or partial position.
- invalid leverage is blocked.
- unsupported live contract mode returns a clear error until live broker support exists.

Run:

```bash
npx vitest run test/tools.test.ts -t "open_position|close_position"
```

Expected: FAIL.

- [ ] **Step 2: Implement `open_position`**

Tool schema:

```json
{
  "symbol": "BTC/USDT:USDT",
  "side": "long",
  "notional_usdt": 200,
  "leverage": 5,
  "order_type": "market",
  "price": 65000
}
```

Behavior:

- validate paper mode for now,
- normalize symbol,
- fetch mark price before risk check,
- call `broker.createOrder()` through a new `broker` tool dependency,
- log trade/fill with `actor_type="session"`.

- [ ] **Step 3: Implement `close_position`**

Tool schema:

```json
{
  "symbol": "BTC/USDT:USDT",
  "side": "long",
  "amount": 0.003,
  "order_type": "market",
  "price": 66000
}
```

If `amount` is omitted, close full position.

- [ ] **Step 4: Update system prompt**

Update `SYSTEM_BASE` to tell the model:

- use `buy/sell` for spot-style trades,
- use `open_position/close_position` for paper USDT contracts,
- always inspect portfolio and risk before opening.

- [ ] **Step 5: Verify tool tests**

Run:

```bash
npx vitest run test/tools.test.ts -t "open_position|close_position|get_portfolio"
```

Expected: PASS.

---

## Task 9: Add LLM Trader Job Model

**Files:**
- Modify: `src/memory.ts`
- Modify: `src/daemon.ts`
- Add: `src/tools/llm-trader-job.ts`
- Modify: `src/tools/index.ts`
- Test: `test/llm-trader-job.test.ts`

- [ ] **Step 1: Add failing job tests**

Test:

- create a scheduled LLM trader job bound to active bot,
- list jobs,
- disable a job,
- job prompt runs in a system session and can call the same paper tools,
- job trades are attributed with `actor_type="llm_trader"`.

Run:

```bash
npx vitest run test/llm-trader-job.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Use existing cron loop first**

Do not invent a new scheduler yet. Add a thin model over existing `cron_jobs`:

- `llm_trader_jobs`
- `cron_job_id`
- `bot_id`
- `trading_account_id`
- `session_id`
- `prompt`
- `enabled`

The daemon can keep executing via `agent.chatInSession()`.

- [ ] **Step 3: Add job tool**

Add `llm_trader_job` tool actions:

- `create`
- `list`
- `disable`
- `enable`
- `delete`

- [ ] **Step 4: Verify job tests**

Run:

```bash
npx vitest run test/llm-trader-job.test.ts
```

Expected: PASS.

---

## Task 10: Documentation And Operational Checks

**Files:**
- Modify: `docs/persistence.md`
- Modify: `docs/architecture.html`
- Modify: `.env.example`

- [ ] **Step 1: Document current model**

Update docs with:

- public market data does not require exchange API credentials,
- paper mode never sends exchange orders,
- paper balances, orders, positions, fills and bot allocations persist in SQLite,
- first implementation supports USDT linear paper contracts only,
- live contract trading remains out of scope.

- [ ] **Step 2: Add env examples**

Add optional paper-specific vars:

```bash
PAPER_TRADING=true
INITIAL_BALANCE_USDT=2000
DEFAULT_EXCHANGE=okx
PAPER_MAX_LEVERAGE=5
PAPER_TAKER_FEE_BPS=0
PAPER_MAKER_FEE_BPS=0
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run build
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual daemon smoke test**

Run:

```bash
MEMORY_DB_PATH=/tmp/crypto-agent-paper-smoke.db \
PAPER_TRADING=true \
INITIAL_BALANCE_USDT=2000 \
DEFAULT_EXCHANGE=okx \
npm run daemon
```

In another terminal:

```bash
npm run dev
```

Ask:

```text
查看当前 paper 组合，不要下真实订单。
```

Expected:

- daemon starts,
- portfolio shows active bot allocation around 2000 USDT,
- no exchange API key is required for public market data,
- no live order is sent.

---

## Acceptance Criteria

- [ ] `PAPER_TRADING=true` with `INITIAL_BALANCE_USDT=2000` persists a paper bot allocation and does not reset it on restart.
- [ ] `BTC/USDT` and `ETH/USDT` spot paper orders still work through old `buy/sell` tools.
- [ ] `BTC/USDT:USDT` and `ETH/USDT:USDT` paper contract long/short positions work through `open_position/close_position`.
- [ ] `get_portfolio` shows bot allocation, free/used USDT, open spot/contract positions, unrealized PnL, open orders.
- [ ] Existing fast-path strategy tests still pass through the adapter.
- [ ] Existing identity tables remain the source of account/bot/session attribution.
- [ ] Paper market data path uses public CCXT data and does not require trading API credentials.
- [ ] Live mode behavior is not broadened by this refactor.
- [ ] `npm run build` passes.
- [ ] `npm test` passes.

## Self-Review

- The trading algorithms stay put; this plan changes the account and broker substrate underneath them.
- The adapter prevents a broad rewrite of every existing tool and executor call site.
- The first paper contract model is intentionally simplified but explicit: isolated USDT linear, no funding, no auto-liquidation.
- Bot allocation becomes real accounting, not just a label on historical rows.
- Market data and execution are separated, so local paper trading can watch OKX public markets without OKX trading credentials.
- Multi-bot concurrent scheduling is prepared by schema and actor attribution, but not forced into the first implementation.
