import importlib.util
import sqlite3

import pytest

HAS_LANGGRAPH = importlib.util.find_spec("langgraph") is not None
pytestmark = pytest.mark.skipif(not HAS_LANGGRAPH, reason="langgraph is not installed")

if HAS_LANGGRAPH:
    from crypto_agent.agents.researcher_graph import build_researcher_graph
    from crypto_agent.agents.trader_graph import build_trader_graph
    from crypto_agent.backtest.validators import StrategyValidationService
    from crypto_agent.db.schema import initialize_database
    from crypto_agent.tools.registry import build_default_registry
    from crypto_agent.trading.order_executor import OrderExecutor
    from crypto_agent.trading.paper_broker import PaperBroker
    from crypto_agent.trading.risk_gate import RiskGate


def test_researcher_graph_creates_and_validates_strategy_package(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    graph = build_researcher_graph()

    state = graph.invoke(
        {
            "tool_registry": build_default_registry(),
            "deps": {"strategy_validation_service": StrategyValidationService(db_path)},
            "bot_id": "bot-default",
            "resident_agent_id": None,
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
        }
    )

    assert state["outcome"] == "validated"
    assert state["package_id"].startswith("strategy-package-")
    assert state["validation"]["status"] == "passed"


def test_trader_graph_places_paper_order_through_risk_gate(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    broker = PaperBroker(db_path)
    graph = build_trader_graph()

    state = graph.invoke(
        {
            "tool_registry": build_default_registry(),
            "deps": {
                "db_path": db_path,
                "order_executor": OrderExecutor(risk_gate=RiskGate(db_path), broker=broker),
            },
            "trading_account_id": "trading-paper-default",
            "bot_id": "bot-default",
            "symbol": "BTC/USDT:USDT",
            "side": "buy",
            "position_side": "long",
            "quantity": 0.001,
            "leverage": 1,
            "mark_price": 50_000,
        }
    )

    assert state["outcome"] == "ordered"
    assert state["order_result"]["status"] == "filled"
    assert state["portfolio_after"]["positions"][0]["symbol"] == "BTC/USDT:USDT"


def test_researcher_package_can_flow_into_trader_deployment_and_order(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    registry = build_default_registry()
    validation_service = StrategyValidationService(db_path)
    research_state = build_researcher_graph().invoke(
        {
            "tool_registry": registry,
            "deps": {"strategy_validation_service": validation_service},
            "bot_id": "bot-default",
            "resident_agent_id": None,
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
        }
    )
    broker = PaperBroker(db_path)

    trader_state = build_trader_graph().invoke(
        {
            "tool_registry": registry,
            "deps": {
                "db_path": db_path,
                "strategy_validation_service": validation_service,
                "order_executor": OrderExecutor(risk_gate=RiskGate(db_path), broker=broker),
            },
            "strategy_package_id": research_state["package_id"],
            "allocated_capital": 500,
            "trading_account_id": "trading-paper-default",
            "bot_id": "bot-default",
            "symbol": "BTC/USDT:USDT",
            "side": "buy",
            "position_side": "long",
            "quantity": 0.001,
            "leverage": 1,
            "mark_price": 50_000,
        }
    )

    assert trader_state["outcome"] == "ordered"
    assert trader_state["strategy_deployment_id"].startswith("strategy-deployment-")
    with sqlite3.connect(db_path) as conn:
        deployments = conn.execute("select count(*) from strategy_deployments").fetchone()[0]
    assert deployments == 1
