# Strategy Agent Roadmap

## Purpose

This roadmap records the implementation order for converging `crypto-agent`
around strategy packages, resident researchers, resident traders, deterministic
runtime execution, paper-first governance, and later live readiness.

The first principle is that trading execution and strategy governance are
different responsibilities:

- Resident researchers create and revise `strategy_packages`.
- Validators record evidence in `strategy_validations`.
- Resident traders allocate capital and manage `strategy_deployments`.
- `StrategyRuntime`, `RiskGate`, `OrderExecutor`, broker, and exchange execute.

The project has not shipped a stable external schema, so old SQLite
compatibility is not required. Deployment can archive or delete the database and
start from a fresh schema.

## Priority Order

### P0: Stabilize Current Strategy Package Slice

Status: in progress in this branch.

Required outcomes:

- `strategy_package`, `validate_strategy`, and `deploy_strategy` tools are
  registered and tested.
- Deployments can be activated, paused, resumed, stopped, and listed.
- Active deployments restart through the daemon.
- Fresh database daemon smoke starts cleanly.
- Current uncommitted implementation is verified before commit.

Why first: continuing feature work while this slice is unverified makes later
failures ambiguous.

### P1: Converge Resident Agents On Packages And Deployments

Status: in progress in this branch.

Required outcomes:

- `resident_agent.spawn` no longer requires a legacy `strategy_mandate`.
- Resident trader prompts include strategy packages and deployments.
- Legacy mandate assignments remain readable but are no longer the trader
  happy-path gate.
- Resident traders supervise deployments instead of improvising direct strategy
  logic every wake.

Why second: without this, the new package/deployment flow and the older mandate
flow remain two separate systems.

### P2: Remove Direct Strategy-Creation Bypass From Agent Workflows

Required outcomes:

- Resident researcher and trader tool policies stop using direct
  `plan_strategy`, `plan_grid_strategy`, and `plan_ladder_strategy` as a
  production path.
- The replacement production path is:

```text
strategy_package.create
validate_strategy.run or validate_strategy.waive_for_paper
deploy_strategy.activate
```

- Existing direct strategy tools are either restricted to manual/debug use or
  rewritten to create packages instead of runtime strategies.

Why third: direct strategy creation bypasses validation, deployment lifecycle,
capital ownership, and resident trader supervision.

### P3: Upgrade Validation From Compiler Pass To Evidence Gate

Required outcomes:

- `validate_strategy.run` records compiler checks for all package kinds.
- `signal` packages run condition-based backtests using the existing
  `BacktestEngine.runConditionBased` path.
- Validation metrics include trade count, win rate, Sharpe, max drawdown, total
  return, candle count, symbol, timeframe, and validation window.
- `paper_ready` can be granted by passed validation or explicit paper waiver.
- `live_ready` requires passed validation and explicit promotion policy.
- `grid` and `ladder` remain paper-waiver only until real simulators exist.

Why fourth: a strategy that compiles is not necessarily a strategy worth
running.

### P4: Complete Paper Trading Observability

Required outcomes:

- Deployment status views include associated strategy instances, open
  positions, pending orders, fills, realized PnL, unrealized PnL, budget usage,
  last signal, and last error.
- Resident trader prompt includes a compact deployment health summary.
- Pause and stop cancel open resting orders through existing runtime stop
  behavior.
- Fresh daemon restart restores active deployments and paper state.

Why fifth: paper trading is the rehearsal layer for production behavior. It
must be auditable before live trading.

### P5: Rewrite Researcher Workflow Around Strategy Packages

Required outcomes:

- Resident researchers search KB before proposing new work.
- Failed hypotheses are logged with explicit reasons.
- Adopted hypotheses become package drafts or submitted package versions.
- Researcher output does not allocate capital and does not activate
  deployments.
- Package revisions create new immutable versions.

Why sixth: research should produce reusable, reviewable artifacts, not one-off
chat text.

### P6: Make `strategy_instances` The Runtime Source Of Truth

Required outcomes:

- `strategy_instances` becomes the durable execution identity for deployment
  materialization.
- The old `strategies` table is removed or demoted to a runtime cache.
- `StrategyManager` loads from strategy instances rather than parallel
  snapshots.
- No old database migration is added; deployment resets schema.

Why seventh: two sources of truth invite silent drift between packages,
deployments, runtime strategy snapshots, and audit rows.

### P7: Live Readiness Gate

Required outcomes:

- Live deployments require package status `live_ready` and validation
  `passed`.
- Live activation checks OKX symbol, swap market type, leverage, margin mode,
  position mode, min notional, available balance, API permission, and human
  approval policy.
- Paper broker remains the only simulation layer. Live exchange code does not
  simulate fills.
- A live dry-run/check action reports what would be configured without placing
  an order.

Why eighth: live trading without paper evidence and exchange preflight is not a
controlled engineering system.

### P8: Deployment And Operations

Required outcomes:

- Docker/systemd deployment is updated after P1-P4 pass locally.
- Server deployment backs up or removes the old DB intentionally.
- `.env` secrets stay outside git and are not printed in logs.
- Remote daemon smoke confirms IPC, paper mode, package deployment status, and
  restart recovery.

Why last: deployment before the architecture is internally coherent only makes
debugging harder.

## Current Execution Slice

The current implementation slice is P0 plus P1 and is tracked in:

- `docs/superpowers/plans/2026-06-22-resident-package-convergence.md`
- `docs/superpowers/plans/2026-06-22-strategy-package-runtime.md`
- `docs/superpowers/specs/2026-06-22-strategy-package-runtime-design.md`

## Definition Of Closed Loop

The system is considered closed-loop for paper mode when this flow works after a
fresh database restart:

```text
human/main agent creates resident researcher and trader
researcher creates strategy package
validator records evidence or paper waiver
trader activates paper deployment with owned capital allocation
runtime executes deterministic strategy instances
paper broker records orders, fills, positions, margin, and PnL
trader wakes on schedule and can hold, pause, stop, or request revision
daemon restarts and active deployments resume
```

Live mode is not considered ready until P7 is complete.

