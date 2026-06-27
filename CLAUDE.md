# CLAUDE.md

This file mirrors the active repo guidance for Claude Code. The repository is a
Python-only crypto trading agent after a breaking migration. The old
TypeScript, npm, Ink UI, Vitest, and Node daemon stack is not part of the active
runtime.

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

- `crypto_agent/main.py` - CLI entrypoint for health, init-db, smoke, and daemon.
- `crypto_agent/ipc/` - JSONL Unix-socket server/client.
- `crypto_agent/agents/` - Python LangGraph graphs and resident runtime.
- `crypto_agent/tools/` - Python tool registry and tool handlers.
- `crypto_agent/trading/` - PaperBroker, RiskGate, OrderExecutor, LiveExchange.
- `crypto_agent/backtest/` - signal strategy backtest and validation.
- `crypto_agent/db/schema.py` - destructive SQLite schema and default identity.
- `tests_py/` - pytest suite.
- `agents/residents/` - resident researcher/trader profile files.

## Core Invariant

Every strategy, resident run, order, fill, position, trade, and risk denial must
be traceable through:

```text
funding_account
  -> trading_account
    -> trading_bot
      -> bot_allocation
        -> resident_agent
          -> agent_run
```

## Runtime Boundary

LangGraph coordinates agent flow. It does not own exchange accounting or risk
control. Trading correctness lives in deterministic Python services and pytest
coverage.

## Rules For Future Changes

- Do not restore npm, TypeScript agent code, Ink UI, Vitest, or Node systemd.
- Use Python modules and pytest for all core runtime work.
- No database backward compatibility is required unless the user explicitly
  changes that policy.
- Paper trading must remain separate from live exchange execution.
- Live OKX behavior must pass a separate readiness/preflight before real orders.
