# Strategy Package And Resident Trading Architecture Design

## Purpose

This document defines the next architecture for research-driven trading in
`crypto-agent`.

The central change is:

```text
Researcher creates Strategy Package
Validator records evidence
Resident Trader manages capital and lifecycle
Strategy Runtime executes deterministic rules
Broker/Exchange performs paper or live execution
```

This replaces the weaker model where an LLM decides every trade from a prompt.
The LLM remains important, but it moves up the stack: research, strategy design,
allocation, review, and exception handling. Fast trading decisions run through
explicit strategy specifications.

The project has not shipped a stable public schema. We do not need backward
compatibility with old SQLite databases. Deployment may archive or delete the
old DB and recreate schema from scratch.

## First Principles

Trading work has different time scales:

1. Research is slow and exploratory.
2. Strategy approval is deliberate and auditable.
3. Signal execution is frequent and deterministic.
4. Order execution must be serialized, risk-gated, and attributable.

An LLM is appropriate for 1 and 2, acceptable for high-level supervision in 3,
and inappropriate as the sole low-latency executor in 4.

The architecture should therefore separate:

- who created an idea,
- who approved it,
- which bot owns the money,
- which strategy produced the signal,
- which actor initiated a run,
- which broker actually executed the order.

## Current State

Implemented pieces already exist:

- `CryptoDaemon` owns the long-lived runtime and exposes Unix-socket IPC.
- `CryptoAgent` runs the LangGraph-style tool loop.
- `resident_agents` represent long-lived actors with schedules, system
  sessions, bot bindings, capital allocation, and run history.
- `strategy_mandates` store reusable playbooks with validation status.
- `StrategyManager` persists strategy snapshots and builds `signal`, `grid`,
  and `ladder` strategy instances.
- `StrategyRuntime` starts strategies, subscribes to market data, and forwards
  signals to `OrderExecutor`.
- `PaperBroker` performs local paper orders, fills, positions, margin, and PnL.
- `LiveExchange` sends real orders through CCXT.
- Trade-bearing rows carry bot/account attribution.

The missing piece is the bridge from "research produced a strategy" to
"trading engine runs this strategy as an explicit, versioned, supervised
deployment".

## Target Mental Model

### Strategy Package

A Strategy Package is the durable unit of strategy knowledge. It is not just a
prompt and not just executable JSON. It contains both:

- a human-readable mandate, and
- a machine-executable strategy spec.

One package can have multiple versions. A package version is immutable once it
has been submitted for validation or deployed. Changes produce a new version.

### Resident Researcher

A Resident Researcher is a long-running research actor. It may:

- inspect market data,
- inspect prior strategy outcomes,
- propose new strategy packages,
- propose revisions to existing packages,
- record rejected hypotheses.

It may not allocate capital or activate deployments.

### Validator

The Validator is not necessarily an LLM. It is the evidence layer.

It may:

- run syntax and schema validation,
- run condition-based backtests,
- run grid/ladder simulations once those exist,
- record paper-trial evidence,
- mark validation as passed, failed, pending, or waived.

Backtest approval is not fully implemented today, but the schema should make it
first-class so the project does not need another identity refactor later.

### Resident Trader

A Resident Trader is a long-running portfolio/operator actor. It may:

- review strategy packages and validation evidence,
- create paper deployments,
- allocate bot capital,
- pause/resume/stop deployments,
- request revisions from researchers,
- promote a paper-tested strategy toward live only when policy allows it.

It should not reinterpret every signal. Once a deterministic strategy is active,
the runtime executes it.

### Strategy Runtime

The Strategy Runtime is the deterministic execution layer. It:

- loads active strategy deployments,
- materializes executable specs into `Strategy` instances,
- subscribes to market data,
- emits signals,
- relies on `RiskGate`, `tradeLock`, and `OrderExecutor` for order execution.

It does not call the LLM.

### Broker / Exchange

Execution adapters remain below the strategy layer:

- paper mode uses `PaperBroker`,
- live mode uses `LiveExchange`.

Strategies and resident agents express intent. They do not simulate paper
execution themselves.

## Target Data Model

Because old SQLite compatibility is not required, the schema should be cleaned
instead of incrementally patched with `ALTER TABLE`.

### Identity Tables

Keep the current explicit identity chain:

```text
funding_accounts
  -> trading_accounts
  -> trading_bots
  -> bot_allocations
```

`sessions` remain conversation/runtime contexts. A session is bound to a bot
when it can issue trading actions.

### `strategy_packages`

Replaces the current role of `strategy_mandates` as the top-level strategy
resource.

```sql
CREATE TABLE strategy_packages (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  author_agent_id TEXT,
  author_run_id TEXT,
  source TEXT NOT NULL,
  mandate TEXT NOT NULL,
  executable_spec TEXT NOT NULL,
  risk_policy TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  validation_summary TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);
```

Recommended statuses:

- `draft` - researcher idea, not deployable.
- `submitted` - ready for validation.
- `paper_ready` - allowed for paper deployment.
- `live_ready` - allowed for live deployment by policy.
- `rejected` - should not be deployed.
- `deprecated` - replaced by a newer package.

Recommended validation statuses:

- `not_run`
- `pending`
- `passed`
- `failed`
- `waived`

`waived` is allowed for paper smoke tests. Live deployments should require
`passed` unless a human override explicitly records a waiver.

### Strategy Package Shape

The `executable_spec` JSON is the contract between research and runtime.

```ts
type StrategyPackage = {
  id: string;
  version: number;
  familyId: string;
  name: string;
  mandate: {
    thesis: string;
    universe: string[];
    timeframe: string;
    allowedMarketTypes: Array<"spot" | "swap">;
    allowedSides: Array<"long" | "short">;
    operatorNotes: string[];
  };
  executableSpec:
    | SignalExecutableSpec
    | GridExecutableSpec
    | LadderExecutableSpec;
  riskPolicy: {
    maxLeverage: number;
    maxSingleNotionalUsdt: number;
    maxTotalNotionalUsdt: number;
    maxDailyLossUsdt?: number;
    maxDrawdownPct?: number;
    stopLossPct?: number;
    takeProfitPct?: number;
  };
};
```

Signal strategy example:

```ts
type SignalExecutableSpec = {
  kind: "signal";
  symbols: string[];
  timeframe: string;
  side: "long" | "short";
  entry: Condition[];
  exit: Condition[];
  positionSizeUsdt: number;
  stopLossPct: number;
  takeProfitPct: number;
};
```

Grid strategy example:

```ts
type GridExecutableSpec = {
  kind: "grid";
  symbol: string;
  side: "long";
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  sizePerGrid: number;
};
```

The runtime compiler rejects specs that cannot be materialized into current
strategy classes.

### `strategy_validations`

Stores validation evidence for package versions.

```sql
CREATE TABLE strategy_validations (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  package_version INTEGER NOT NULL,
  validator_type TEXT NOT NULL,
  status TEXT NOT NULL,
  dataset_ref TEXT,
  metrics TEXT NOT NULL,
  report TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Example metrics:

```json
{
  "total_return_pct": 4.2,
  "max_drawdown_pct": 2.1,
  "sharpe": 1.05,
  "win_rate_pct": 54.3,
  "trade_count": 37,
  "fee_model": "paper_default",
  "period": "500 candles"
}
```

### `strategy_deployments`

A deployment is one package version running under one bot allocation in one
mode.

```sql
CREATE TABLE strategy_deployments (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  package_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  trading_account_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  capital_allocation_id TEXT NOT NULL,
  resident_trader_id TEXT,
  runtime_policy TEXT NOT NULL,
  started_at TIMESTAMP,
  stopped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Recommended statuses:

- `proposed`
- `active`
- `paused`
- `stopping`
- `stopped`
- `archived`

The deployment owns lifecycle. The package owns logic.

### `strategy_instances`

The runtime may need to split one package into multiple current strategy
instances. For example, a signal package with BTC and ETH can become two
`SignalStrategy` instances because the current `Strategy` abstraction is
single-symbol.

```sql
CREATE TABLE strategy_instances (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  params TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  allocated_usdt REAL NOT NULL DEFAULT 0,
  bot_id TEXT NOT NULL,
  trading_account_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

This replaces the existing `strategies` table in the clean schema.

### Trading Audit Additions

Trade-bearing tables should carry these IDs when applicable:

```text
strategy_package_id
strategy_package_version
strategy_deployment_id
strategy_instance_id
resident_agent_id
agent_run_id
capital_allocation_id
bot_id
trading_account_id
```

Paper and live paths should use the same attribution fields. The broker choice
must not affect audit shape.

## Lifecycle

### 1. Research

The human or main agent asks for research. A Resident Researcher may run on a
schedule or be invoked manually.

Output:

- a draft `strategy_package`,
- optional rejected hypotheses in `strategy_kb`,
- source `agent_run_id` for traceability.

The researcher must produce structured JSON that passes schema validation. If
it cannot produce a valid executable spec, it may write research notes but not a
deployable package.

### 2. Validation

The Validator receives a package version.

For the first implementation, validation can be staged:

1. schema validation,
2. strategy compiler validation,
3. condition-based backtest for `signal` strategies,
4. paper-only waiver for grid/ladder until their backtest simulators exist.

Validation writes `strategy_validations` and updates package
`validation_status`.

### 3. Trader Review

A Resident Trader reviews:

- mandate clarity,
- executable spec,
- validation evidence,
- risk policy,
- current portfolio exposure,
- available bot allocation.

It can create a paper deployment. Live deployment requires stricter policy:

- package status `live_ready`,
- validation `passed`,
- live trading account configured,
- explicit human or policy approval.

### 4. Deployment

Deploying a strategy:

1. creates or reserves a `bot_allocations` row,
2. creates a `strategy_deployments` row,
3. materializes one or more `strategy_instances`,
4. starts instances in `StrategyRuntime`,
5. records an event.

No strategy should be active without a deployment row.

### 5. Execution

The runtime executes instances without LLM calls:

```text
MarketFeed
  -> Strategy instance
  -> Signal
  -> RiskGate
  -> OrderExecutor
  -> PaperBroker or LiveExchange
  -> orders/fills/trades/positions audit rows
```

Resident Trader runs periodically to supervise deployments, not to approve
every signal.

### 6. Monitoring And Intervention

Resident Trader may:

- pause a deployment,
- reduce allocation,
- stop a deployment,
- request a package revision,
- promote a package from paper to live,
- archive a failed strategy.

It should not mutate an active package version. Changes create a new package
version and a new deployment or deployment revision.

## Tool Surface

Keep the tool interface small. The main agent does not need many low-level
worker-control primitives.

### `strategy_package`

Actions:

- `create`
- `show`
- `list`
- `submit`
- `reject`
- `deprecate`

Used by researchers and main agent. Does not deploy capital.

### `validate_strategy`

Actions:

- `run`
- `list`
- `show`
- `waive_for_paper`

Used by validator/researcher/main agent. Writes evidence.

### `deploy_strategy`

Actions:

- `propose`
- `activate`
- `pause`
- `resume`
- `stop`
- `status`

Used by resident traders and main agent. Owns allocation and runtime lifecycle.

### `resident_agent`

Actions remain simple:

- `spawn`
- `status`
- `pause`
- `resume`
- `archive`

Resident agents are independent long-running actors. They are not "subagents"
in the short-task sense.

## Policy Boundaries

### Researcher

Allowed:

- produce draft packages,
- revise draft packages,
- request validation,
- record research outcomes.

Blocked:

- activate deployments,
- allocate capital,
- place orders.

### Validator

Allowed:

- run deterministic validation jobs,
- store metrics,
- mark validation result.

Blocked:

- modify strategy logic after validation starts,
- allocate capital,
- place orders.

### Resident Trader

Allowed:

- create paper deployments,
- allocate capital within its authority,
- pause/resume/stop deployments,
- request revisions,
- promote only when validation and policy allow it.

Blocked:

- silently changing executable strategy logic in-place,
- bypassing deployment attribution,
- opening live deployments without live policy approval.

### Strategy Runtime

Allowed:

- execute active strategy instances,
- cancel resting orders when a deployment stops,
- emit structured events.

Blocked:

- calling LLM,
- allocating new capital,
- changing package status.

## Prompt And Resource Design

Do not hardcode BTC/ETH, 30-minute schedules, or fixed strategy text into
system prompts.

System prompts should define role contracts only. Strategy logic should come
from resources:

- package mandate,
- executable spec,
- risk policy,
- deployment state,
- portfolio snapshot,
- validation evidence.

This keeps resident agents reusable. A trader can supervise a grid strategy,
trend strategy, or mean-reversion strategy without changing its system prompt.

## Paper And Live Modes

The strategy layer should be mode-agnostic.

```text
Strategy intent:
  open/close/limit/cancel

Broker adapter:
  PaperBroker -> local SQLite accounting
  LiveExchange -> CCXT order
```

Paper mode must not require exchange trading credentials. It may use public
market data.

Live mode must not simulate. It passes orders to the exchange adapter and
records live order/fill state.

## Clean Deployment And Database Reset

Because compatibility is not required, implementation should prefer clean
schema over migrations.

Deployment procedure:

```bash
docker compose down
mkdir -p data/archive
ts=$(date +%Y%m%d%H%M%S)
cp -a data/crypto_agent.db data/archive/crypto_agent.db.$ts.bak 2>/dev/null || true
cp -a data/crypto_agent.db-wal data/archive/crypto_agent.db-wal.$ts.bak 2>/dev/null || true
cp -a data/crypto_agent.db-shm data/archive/crypto_agent.db-shm.$ts.bak 2>/dev/null || true
rm -f data/crypto_agent.db data/crypto_agent.db-wal data/crypto_agent.db-shm
docker compose up -d --build
```

Implementation should keep the no-compat test stance:

- no old `llm_trader_jobs`,
- no old `strategy_rules`,
- no SQLite `ALTER TABLE` migration path for previous local schemas,
- no dual write to old and new strategy tables.

## Runtime Invariants

These invariants should be asserted in code and tests:

1. A live or paper order with strategy attribution must have a deployment ID.
2. An active deployment must have a bot allocation.
3. A strategy instance must belong to exactly one deployment.
4. A deployment cannot reference a rejected or deprecated package.
5. Live deployment cannot activate unless policy permits package validation.
6. A package version cannot be mutated after validation or deployment.
7. Stopping a deployment cancels its open resting orders.
8. Resident trader orders must carry `resident_agent_id`, `agent_run_id`,
   deployment ID, package ID, allocation ID, bot ID, and trading account ID.
9. Paper and live execution share attribution fields.
10. LLM decisions can create or supervise deployments, but strategy signal
    execution does not call LLM.

## Error Handling

### Invalid Strategy Package

Reject at package creation with a schema error. Store the research note in
`strategy_kb` if useful, but do not create a deployable package.

### Validation Failure

Set package status to `rejected` or leave it as `draft` with failed validation.
Do not deploy.

### Runtime Materialization Failure

Deployment activation fails before any strategy instance starts. No capital is
marked used. Record an event.

### Strategy Runtime Crash

On daemon restart:

1. load active deployments,
2. materialize strategy instances,
3. reconcile open orders and positions,
4. resume market subscriptions.

### Stop Or Pause

Pause disables new signals but can leave existing positions intact depending on
policy. Stop cancels resting orders and either:

- leaves positions for manual/trader-managed exit, or
- closes them if `runtime_policy.close_on_stop=true`.

The first implementation should default to not force-closing positions unless
the policy explicitly says so.

## Observability

Add events for:

- package created/submitted/rejected/deprecated,
- validation started/completed/failed,
- deployment proposed/activated/paused/resumed/stopped,
- strategy instance started/stopped/error,
- signal emitted/rejected/executed,
- resident trader intervention.

Status views should answer:

- Which packages exist?
- Which ones are deployable?
- Which deployments are active?
- Which bot allocation backs each deployment?
- Which positions/orders belong to each deployment?
- Which agent or session caused each change?

## Minimal Implementation Slices

### Slice 1: Clean Strategy Package Model

Add `strategy_packages`, `strategy_validations`, `strategy_deployments`, and
`strategy_instances`. Remove old mandate-only assumptions. Keep database reset
deployment.

### Slice 2: Package Compiler

Build a compiler:

```text
StrategyPackage.executable_spec
  -> one or more StrategySnapshot-like records
  -> StrategyManager / StrategyRuntime instances
```

Start with `signal` and `grid`, because the codebase already has these runtime
classes. Add `ladder` once package shape is stable.

### Slice 3: Deployment Tool

Add `deploy_strategy` to allocate capital, create deployment rows, materialize
instances, and start/stop runtime instances.

### Slice 4: Resident Trader Governance

Update resident trader prompt/context so it manages packages and deployments,
not individual ad hoc trades. It can still use direct order tools for emergency
manual interventions, but normal strategy execution should use deployments.

### Slice 5: Validation Platform

Promote current lightweight `backtest` into package-level validation records.
`signal` strategies can use condition-based backtests immediately. `grid` and
`ladder` can initially support schema validation plus paper-only waiver.

## Acceptance Criteria

The new architecture is working when a fresh database can complete this flow:

1. A researcher creates a draft package for BTC/ETH.
2. The package passes schema and compiler validation.
3. A validation record is stored.
4. A resident trader creates a paper deployment with a 300 USDT allocation.
5. The deployment materializes strategy instances.
6. `StrategyRuntime` starts those instances without LLM calls.
7. A market event triggers a signal.
8. `RiskGate` accepts or rejects the signal with a recorded reason.
9. `OrderExecutor` routes the order to `PaperBroker`.
10. SQLite records package, deployment, instance, bot, allocation, and actor
    attribution on orders/fills/trades.
11. Pausing the deployment stops new signals.
12. Stopping the deployment cancels resting orders.

## Explicit Non-Goals For The First Implementation

- No old database compatibility.
- No live autonomous deployment by default.
- No optimizer that searches parameter space automatically.
- No full grid/ladder backtest engine in the first slice.
- No multi-daemon distributed scheduling.
- No vector database requirement for research memory.
- No LLM call inside strategy signal evaluation.

## Open Product Decision

The only product decision that remains before implementation is policy strictness
for paper deployments:

1. **Permissive paper:** schema + compiler validation is enough; backtest may be
   `waived`.
2. **Strict paper:** every package must have a passed validation record before
   paper deployment.

Recommendation: use permissive paper and strict live. Paper is where weak ideas
should be tested safely. Live should require validation plus explicit approval.
