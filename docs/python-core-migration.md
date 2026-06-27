# Python Core Migration

## Status

The repository has completed the breaking move to a Python-only core. The
TypeScript daemon, npm package, Ink UI, Vitest tests, Node systemd service, and
old TS design-plan archive have been removed from the active tree.

The target runtime is now the only runtime:

```text
Python daemon
  -> Python LangGraph graphs
  -> Python tool registry
  -> Python trading services
  -> Python SQLite schema
  -> Docker deployment
```

## Non-Compatibility Rule

There is no old database compatibility requirement. Deployments may reset SQLite
with `crypto-agent-py init-db --destructive` or by running the daemon with
`--destructive` when the user explicitly asks for a clean redeploy.

## Current Module Layout

```text
crypto_agent/
  main.py
  config.py
  db/schema.py
  domain/
  trading/
  backtest/
  agents/
  tools/
  ipc/
  cli/
tests_py/
agents/residents/
```

## Implemented Closure

- `crypto-agent-py init-db --destructive` creates the Python SQLite schema and
  default identity chain.
- `PaperBroker` persists paper orders, fills, positions, trades, and realized
  PnL.
- `RiskGate` enforces allocation notional, max leverage, max position
  percentage, drawdown halt, and persists denials.
- `OrderExecutor` blocks denied orders before broker execution.
- `StrategyValidationService` creates signal strategy packages, runs
  deterministic backtests, stores validation reports, and blocks deployment
  until validation passes.
- Python tool registry exposes portfolio, order, strategy creation,
  validation, and deployment tools.
- Python LangGraph researcher and trader graphs run through `StateGraph`.
- `ResidentRuntime` persists resident agents and audited runs.
- `crypto-agent-py smoke` verifies clean-DB researcher-to-trader paper closure.
- `CryptoAgentIpcServer` exposes Unix-socket JSONL `health` and `smoke`.
- `LiveExchange` wraps OKX swap market order parameters for live integration
  tests.
- `Dockerfile` and `docker-compose.yml` run the Python daemon.

## Completion Check

The migration is considered functionally closed when this command passes:

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest tests_py -q
```

And this smoke path succeeds:

```bash
crypto-agent-py smoke \
  --database-path data/smoke.db \
  --profile-path agents/residents/btc-eth-researcher/AGENT.md \
  --destructive
```

## Open Risk

Live OKX private trading remains intentionally unverified. The live adapter has
parameter-level coverage, but real private balance and live order preflight must
be run separately with valid credentials before live trading is enabled.
