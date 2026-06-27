# Python Core Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Node/TypeScript crypto-agent core with a Python daemon, Python LangGraph agent runtime, Python tool layer, Python trading engine, and Python SQLite access layer.

**Architecture:** Build a new Python core beside the current TypeScript runtime until the Python path proves the full researcher-to-paper-trade loop. The Python daemon owns configuration, SQLite repositories, trading services, resident scheduling, and LangGraph graphs. No legacy database compatibility is required.

**Tech Stack:** Python 3.12, pytest, sqlite3 initially, pydantic/pydantic-settings, Python LangGraph, ccxt Python, Docker.

**Implementation Status (2026-06-27):**
- Completed Python slices: Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8, Task 9, and the Docker/daemon/resident-runtime parts of Task 10.
- Added a `smoke` CLI command that verifies the local Python paper loop from clean SQLite: researcher creates and validates a strategy package, trader deploys it, RiskGate allows the order, and PaperBroker fills it.
- Added Python `LiveExchange` adapter tests around ccxt/OKX swap order params, leverage setting, margin mode, position side, and reduce-only behavior.
- Added a Unix-socket JSONL daemon surface with `health` and `smoke` IPC messages.
- Verified with system Python: `20 passed, 7 skipped`; skipped tests require LangGraph.
- Verified with a dependency-installed venv: `27 passed`; LangGraph, daemon IPC smoke, CLI smoke, and closed-position smoke tests execute there.
- Manually verified `crypto-agent-py daemon` starts, creates a Unix socket, and returns health over IPC.
- Verified production Docker build and run on `kr.cree1p.com`; the active container command is `crypto-agent-py daemon ...`, healthcheck is healthy, and user-systemd `crypto-agent` is inactive.
- Verified remote IPC health and remote IPC smoke against a clean DB. Remote DB counts after smoke: `resident_agents=2`, `agent_runs=3`, `strategy_packages=1`, `strategy_validations=1`, `strategy_deployments=1`, `paper_orders=2`, `paper_fills=2`, `paper_positions=1`, `trades=1`, `risk_denials=0`; BTC long quantity is `0.0`, realized PnL is `1.0`.
- Live private OKX preflight was not executed because configured `EXCHANGE_API_KEY`, `EXCHANGE_SECRET`, and `EXCHANGE_PASSWORD` values are empty. Live orders remain disabled pending a separate credentialed live-readiness pass.

---

### Task 1: Python Project Skeleton And Health

**Files:**
- Create: `pyproject.toml`
- Create: `crypto_agent/__init__.py`
- Create: `crypto_agent/config.py`
- Create: `crypto_agent/main.py`
- Create: `tests_py/test_health.py`
- Modify: `.gitignore` if Python cache/output paths are missing

- [ ] **Step 1: Write failing test**

Create `tests_py/test_health.py`:

```python
from crypto_agent.config import Settings
from crypto_agent.main import build_health_payload


def test_health_payload_reports_runtime_and_database_path(tmp_path):
    settings = Settings(database_path=tmp_path / "crypto_agent.db", environment="test")

    payload = build_health_payload(settings)

    assert payload["status"] == "ok"
    assert payload["runtime"] == "python"
    assert payload["environment"] == "test"
    assert payload["database_path"].endswith("crypto_agent.db")
```

- [ ] **Step 2: Run test to verify failure**

Run: `python3 -m pytest tests_py/test_health.py -q`

Expected: fail with `ModuleNotFoundError: No module named 'crypto_agent'`.

- [ ] **Step 3: Implement minimal code**

Create the package, settings dataclass, and health payload function. The implementation should not import LangGraph or exchange dependencies yet.

- [ ] **Step 4: Run test to verify pass**

Run: `python3 -m pytest tests_py/test_health.py -q`

Expected: pass.

### Task 2: Destructive SQLite Schema Initialization

**Files:**
- Create: `crypto_agent/db/__init__.py`
- Create: `crypto_agent/db/schema.py`
- Create: `tests_py/test_db_schema.py`

- [ ] **Step 1: Write failing tests**

Create tests that call `initialize_database(path, destructive=True)` and assert the identity chain tables exist with default rows:

```python
import sqlite3

from crypto_agent.db.schema import initialize_database


def table_count(db_path, table):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(f"select count(*) from {table}").fetchone()[0]


def test_initialize_database_creates_identity_chain(tmp_path):
    db_path = tmp_path / "crypto_agent.db"

    initialize_database(db_path, destructive=True)

    assert table_count(db_path, "funding_accounts") == 1
    assert table_count(db_path, "trading_accounts") == 1
    assert table_count(db_path, "trading_bots") == 1
    assert table_count(db_path, "bot_allocations") == 1


def test_destructive_initialize_removes_old_business_state(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute("insert into strategy_kb(agent_id, symbol, timeframe, content) values (?, ?, ?, ?)", ("agent-1", "BTC/USDT:USDT", "1h", "old"))

    initialize_database(db_path, destructive=True)

    assert table_count(db_path, "strategy_kb") == 0
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python3 -m pytest tests_py/test_db_schema.py -q`

Expected: fail because `crypto_agent.db.schema` does not exist.

- [ ] **Step 3: Implement schema**

Implement `initialize_database(db_path, destructive=False)` with `sqlite3`. Create the P0 schema for identity, resident agents, agent runs, strategy packages, validations, deployments, paper orders, fills, positions, trades, strategy KB, and daemon state.

- [ ] **Step 4: Run tests to verify pass**

Run: `python3 -m pytest tests_py/test_db_schema.py -q`

Expected: pass.

### Task 3: Minimal Daemon Entrypoint

**Files:**
- Modify: `crypto_agent/main.py`
- Create: `tests_py/test_main_cli.py`

- [ ] **Step 1: Write failing test**

Test that `main(["health", "--database-path", "..."])` prints JSON health and does not require an LLM key.

- [ ] **Step 2: Run test to verify failure**

Run: `python3 -m pytest tests_py/test_main_cli.py -q`

Expected: fail because CLI handling is not implemented.

- [ ] **Step 3: Implement CLI**

Implement `health` and `init-db --destructive` commands using `argparse`.

- [ ] **Step 4: Run test to verify pass**

Run: `python3 -m pytest tests_py/test_main_cli.py -q`

Expected: pass.

### Task 4: Python Docker Entrypoint

**Files:**
- Create: `Dockerfile.python`
- Create: `docker-compose.python.yml`

- [ ] **Step 1: Add image build files**

Create a Python 3.12 slim image that installs the package and runs `python -m crypto_agent.main health` for healthcheck.

- [ ] **Step 2: Build image**

Run: `docker build -f Dockerfile.python -t crypto-agent-python:dev .`

Expected: image builds.

- [ ] **Step 3: Run container health command**

Run: `docker run --rm crypto-agent-python:dev python -m crypto_agent.main health`

Expected: JSON payload with `"runtime": "python"`.

### Task 5: Paper Broker Domain Slice

**Files:**
- Create: `crypto_agent/domain/orders.py`
- Create: `crypto_agent/trading/broker.py`
- Create: `crypto_agent/trading/paper_broker.py`
- Create: `tests_py/test_paper_broker.py`

- [ ] **Step 1: Write failing paper-order test**

Test opening and closing a BTC/USDT:USDT long paper position updates orders, fills, position quantity, and realized PnL.

- [ ] **Step 2: Run test to verify failure**

Run: `python3 -m pytest tests_py/test_paper_broker.py -q`

Expected: fail because paper broker modules do not exist.

- [ ] **Step 3: Implement minimal broker**

Implement only market orders against supplied mark prices. Persist orders/fills/positions in SQLite.

- [ ] **Step 4: Run test to verify pass**

Run: `python3 -m pytest tests_py/test_paper_broker.py -q`

Expected: pass.

### Task 6: RiskGate And OrderExecutor

**Files:**
- Create: `crypto_agent/domain/risk.py`
- Create: `crypto_agent/trading/risk_gate.py`
- Create: `crypto_agent/trading/order_executor.py`
- Create: `tests_py/test_risk_gate.py`

- [ ] **Step 1: Write failing tests**

Test that leverage, allocation, exposure, and drawdown failures reject before broker order creation.

- [ ] **Step 2: Implement deterministic gate**

Return structured `RiskDecision(allowed, reason, rule)` and persist denials to audit storage.

- [ ] **Step 3: Verify**

Run: `python3 -m pytest tests_py/test_risk_gate.py -q`

Expected: pass.

### Task 7: Strategy Package And Backtest Validation

**Files:**
- Create: `crypto_agent/domain/strategy.py`
- Create: `crypto_agent/backtest/engine.py`
- Create: `crypto_agent/backtest/validators.py`
- Create: `tests_py/test_backtest_validation.py`

- [ ] **Step 1: Write failing strategy-validation tests**

Test that a strategy package cannot become paper-ready without a stored validation report.

- [ ] **Step 2: Implement signal evaluator and validation report**

Support P0 signal conditions only: price, RSI, SMA, Bollinger.

- [ ] **Step 3: Verify**

Run: `python3 -m pytest tests_py/test_backtest_validation.py -q`

Expected: pass.

### Task 8: Python Tool Registry

**Files:**
- Create: `crypto_agent/tools/registry.py`
- Create: `crypto_agent/tools/trading_tools.py`
- Create: `crypto_agent/tools/strategy_tools.py`
- Create: `tests_py/test_tools_registry.py`

- [ ] **Step 1: Write failing registry tests**

Test typed tool registration, dependency injection, and dispatch for `get_portfolio`, `open_position`, `create_strategy_package`, and `validate_strategy`.

- [ ] **Step 2: Implement registry and tools**

Use Pydantic models for tool args once dependencies are installed.

- [ ] **Step 3: Verify**

Run: `python3 -m pytest tests_py/test_tools_registry.py -q`

Expected: pass.

### Task 9: Python LangGraph Agent Runtime

**Files:**
- Create: `crypto_agent/agents/state.py`
- Create: `crypto_agent/agents/main_graph.py`
- Create: `crypto_agent/agents/researcher_graph.py`
- Create: `crypto_agent/agents/trader_graph.py`
- Create: `tests_py/test_agent_graphs.py`

- [ ] **Step 1: Write fake-LLM graph tests**

Test researcher creates a strategy package plus validation record, and trader places a paper order through RiskGate.

- [ ] **Step 2: Implement graphs**

Use Python LangGraph `StateGraph`, explicit tool nodes, deterministic max-tool-round checks, and deterministic outcome verifiers.

- [ ] **Step 3: Verify**

Run: `python3 -m pytest tests_py/test_agent_graphs.py -q`

Expected: pass without real LLM keys.

### Task 10: Resident Scheduler And Docker Cutover

**Files:**
- Create: `crypto_agent/agents/resident_runtime.py`
- Create: `crypto_agent/ipc/server.py`
- Create: `crypto_agent/cli/main.py`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Write scheduler tests**

Test resident profile loading, interval due checks, agent run audit rows, and restart recovery.

- [ ] **Step 2: Implement runtime**

Implement resident scheduler and a minimal IPC/CLI surface for status and chat.

- [ ] **Step 3: Replace deployment**

Switch production Dockerfile/compose from Node daemon to Python daemon.

- [ ] **Step 4: Remote smoke**

After local tests pass, redeploy to `kr.cree1p.com`, clean DB, create researcher/trader residents, and verify paper order closure.
