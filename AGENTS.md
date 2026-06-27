## First Principles & Active Skepticism

Reason from first principles: derive conclusions from fundamental truths and
base logic, not from analogy, convention, or "that's how it's done."

- If a question contains a questionable premise, call it out before answering.
- If a better path exists than what the user proposed, say so directly.
- Distinguish between fact, which must be respected, and convention, which can
  be challenged.
- When challenging something, name the assumption, explain why it is flawed, and
  offer a concrete alternative.

--- project-doc ---

# AGENTS.md

This repository is now a Python-only crypto trading agent. The previous
TypeScript daemon, Ink UI, npm workflow, Vitest tests, and Node deployment have
been removed as part of a breaking migration.

## Project Overview

The runtime is a long-lived Python daemon with:

- Python LangGraph graphs for main, researcher, trader, and resident flows.
- Python tool registry for strategy and trading actions.
- Python trading services for paper execution, live OKX adapter contracts, risk
  gates, order execution, strategy validation, and backtesting.
- SQLite persistence through the Python schema in `crypto_agent/db/schema.py`.
- Docker deployment through `Dockerfile` and `docker-compose.yml`.

Production should run exactly one Docker daemon. Do not reintroduce a user
systemd Node service or npm-based daemon.

## Commands

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev,agent]"

crypto-agent-py health
crypto-agent-py init-db --database-path data/crypto_agent.db --destructive
crypto-agent-py smoke \
  --database-path data/smoke.db \
  --profile-path agents/residents/btc-eth-researcher/AGENT.md \
  --destructive

crypto-agent-py daemon \
  --database-path data/crypto_agent.db \
  --socket-path /tmp/crypto-agent-py.sock \
  --environment development \
  --init-db

crypto-agent-py-client --socket-path /tmp/crypto-agent-py.sock health
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest tests_py -q
docker compose up -d --build
```

## Architecture

### Python Daemon

`crypto_agent/main.py` provides the executable entrypoint:

- `health` returns runtime and database metadata.
- `init-db` creates or destructively recreates SQLite.
- `smoke` runs a clean researcher-to-trader paper closure.
- `daemon` starts `CryptoAgentIpcServer`.

### LangGraph Agent Layer

- `crypto_agent/agents/main_graph.py` handles a minimal main graph.
- `crypto_agent/agents/researcher_graph.py` creates and validates strategy
  packages, then verifies that the run left a durable outcome.
- `crypto_agent/agents/trader_graph.py` inspects state, deploys a validated
  package when present, sends an order through the risk gate, and verifies the
  audit result.
- `crypto_agent/agents/resident_runtime.py` persists resident agents and
  `agent_runs`, then dispatches the correct graph.

Graph nodes may call tools, but trading correctness must live in deterministic
Python services, not in prompts.

### Tool Layer

`crypto_agent/tools/registry.py` registers tools and dispatches them with
explicit dependency injection. Current tool modules:

- `crypto_agent/tools/strategy_tools.py`
- `crypto_agent/tools/trading_tools.py`

### Trading Layer

- `crypto_agent/trading/paper_broker.py` is the authoritative paper execution
  and accounting engine.
- `crypto_agent/trading/risk_gate.py` enforces allocation, leverage, exposure,
  and drawdown rules before orders are placed.
- `crypto_agent/trading/order_executor.py` serializes risk check plus execution.
- `crypto_agent/trading/live_exchange.py` wraps OKX swap order parameters for
  live integration tests, but live trading must remain gated by a separate
  readiness pass.

### Backtest And Strategy Validation

- `crypto_agent/backtest/engine.py` evaluates signal strategy packages over
  candle data.
- `crypto_agent/backtest/validators.py` stores strategy packages, validation
  reports, and deployments.

Strategy deployment must be tied to a validation record. The current
implementation covers signal strategies; grid/ladder parity can be added later
in Python.

### Persistence

SQLite schema is owned by `crypto_agent/db/schema.py`. The core identity and
audit chain is:

```text
funding_account
  -> trading_account
    -> trading_bot
      -> bot_allocation
        -> resident_agent
          -> agent_run
            -> strategy_package / strategy_validation / strategy_deployment
            -> paper_order / paper_fill / paper_position / trade / risk_denial
```

No backward database compatibility is required. For redeploys, a destructive DB
reset is acceptable when the user asks for it.

## Conventions

- Python 3.12+.
- Tests live in `tests_py/` and use pytest.
- Runtime package lives under `crypto_agent/`.
- Resident profiles live under `agents/residents/*/AGENT.md`.
- Do not add new TypeScript, npm, Vitest, Ink, or Node daemon code unless the
  user explicitly asks to build a separate UI experiment.
- Keep live exchange behavior behind deterministic gates. Paper mode must never
  require private exchange keys.
