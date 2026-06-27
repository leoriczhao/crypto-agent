import importlib.util
import sqlite3

import pytest

HAS_LANGGRAPH = importlib.util.find_spec("langgraph") is not None
pytestmark = pytest.mark.skipif(not HAS_LANGGRAPH, reason="langgraph is not installed")

if HAS_LANGGRAPH:
    from crypto_agent.agents.resident_runtime import ResidentRuntime
    from crypto_agent.backtest.validators import StrategyValidationService
    from crypto_agent.db.schema import initialize_database
    from crypto_agent.tools.registry import build_default_registry
    from crypto_agent.trading.order_executor import OrderExecutor
    from crypto_agent.trading.paper_broker import PaperBroker
    from crypto_agent.trading.risk_gate import RiskGate


def count_rows(db_path, table):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(f"select count(*) from {table}").fetchone()[0]


def test_resident_runtime_runs_researcher_and_trader_with_audited_runs(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    profile_path = tmp_path / "AGENT.md"
    profile_path.write_text("# BTC ETH Paper Resident\n", encoding="utf-8")
    initialize_database(db_path, destructive=True)
    broker = PaperBroker(db_path)
    runtime = ResidentRuntime(
        db_path,
        tool_registry=build_default_registry(),
        deps={
            "db_path": db_path,
            "strategy_validation_service": StrategyValidationService(db_path),
            "order_executor": OrderExecutor(risk_gate=RiskGate(db_path), broker=broker),
        },
    )

    researcher_id = runtime.spawn_resident(
        type="researcher",
        name="BTC ETH Researcher",
        profile_path=profile_path,
        bot_id="bot-default",
    )
    research_state = runtime.run_once(
        researcher_id,
        {
            "symbol": "BTC/USDT:USDT",
            "timeframe": "1h",
            "name": "BTC breakout",
            "entry_conditions": [{"indicator": "price", "operator": ">", "value": 100}],
            "exit_conditions": [{"indicator": "price", "operator": "<", "value": 98}],
            "candles": [
                {"timestamp": "2026-01-01T00:00:00Z", "open": 99, "high": 100, "low": 98, "close": 99, "volume": 10},
                {"timestamp": "2026-01-01T01:00:00Z", "open": 100, "high": 103, "low": 99, "close": 102, "volume": 11},
                {"timestamp": "2026-01-01T02:00:00Z", "open": 103, "high": 104, "low": 96, "close": 97, "volume": 12},
            ],
        },
    )

    assert research_state["outcome"] == "validated"
    trader_id = runtime.spawn_resident(
        type="trader",
        name="BTC ETH Trader",
        profile_path=profile_path,
        bot_id="bot-default",
    )
    trader_state = runtime.run_once(
        trader_id,
        {
            "trading_account_id": "trading-paper-default",
            "strategy_package_id": research_state["package_id"],
            "allocated_capital": 500,
            "symbol": "BTC/USDT:USDT",
            "side": "buy",
            "position_side": "long",
            "quantity": 0.001,
            "leverage": 1,
            "mark_price": 50_000,
        },
    )

    assert trader_state["outcome"] == "ordered"
    assert count_rows(db_path, "resident_agents") == 2
    assert count_rows(db_path, "agent_runs") == 2
    assert count_rows(db_path, "strategy_deployments") == 1
    assert count_rows(db_path, "paper_orders") == 1
