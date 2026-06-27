# Crypto Agent

Python-only crypto trading agent runtime with paper trading, OKX live-exchange
adapter contracts, deterministic risk gates, SQLite persistence, LangGraph
agent flows, and Docker deployment.

The old TypeScript agent/runtime/UI stack has been removed. There is no npm
workflow in the active repository.

## Runtime Shape

```text
Python daemon
  -> Python LangGraph graphs
  -> Python tool registry
  -> Python trading services
  -> SQLite persistence
  -> Docker deployment
```

Core directories:

- `crypto_agent/` - production Python package.
- `tests_py/` - Python test suite.
- `agents/residents/` - durable resident-agent profile files.
- `docs/` - current architecture, persistence, deployment, and migration docs.

## Quick Start

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev,agent]"

crypto-agent-py init-db --database-path data/crypto_agent.db --destructive
crypto-agent-py health --database-path data/crypto_agent.db
crypto-agent-py smoke \
  --database-path data/smoke.db \
  --profile-path agents/residents/btc-eth-researcher/AGENT.md \
  --destructive
```

## Daemon And Client

```bash
crypto-agent-py daemon \
  --database-path data/crypto_agent.db \
  --socket-path /tmp/crypto-agent-py.sock \
  --environment development \
  --init-db

crypto-agent-py-client --socket-path /tmp/crypto-agent-py.sock health
crypto-agent-py-client --socket-path /tmp/crypto-agent-py.sock smoke \
  --profile-path agents/residents/btc-eth-researcher/AGENT.md
```

## Docker

```bash
mkdir -p data runtime
printf "CRYPTO_AGENT_UID=%s\nCRYPTO_AGENT_GID=%s\n" "$(id -u)" "$(id -g)" > .env
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 crypto-agent
```

The container runs `crypto-agent-py daemon` and exposes a Unix socket at
`./runtime/crypto-agent.sock`.

## Tests

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest tests_py -q
```

## Current Scope

- PaperBroker persists local orders, fills, positions, trades, and PnL.
- RiskGate blocks orders that violate allocation, leverage, exposure, or
  drawdown constraints.
- StrategyValidationService creates, backtests, validates, and deploys signal
  strategy packages.
- ResidentRuntime persists researcher/trader residents and audited runs.
- IPC server/client expose `health` and `smoke` commands over JSONL Unix socket.
- LiveExchange wraps OKX swap market order parameters, but live order flow still
  requires a separate readiness pass before real trading is enabled.
