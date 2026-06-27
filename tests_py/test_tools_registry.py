from crypto_agent.backtest.validators import StrategyValidationService
from crypto_agent.db.schema import initialize_database
from crypto_agent.tools.registry import ToolRegistry, build_default_registry
from crypto_agent.trading.order_executor import OrderExecutor
from crypto_agent.trading.paper_broker import PaperBroker
from crypto_agent.trading.risk_gate import RiskGate


def test_registry_rejects_missing_dependency():
    registry = ToolRegistry()
    registry.register("needs_db", "Needs a db", ["db_path"], lambda args, deps: deps["db_path"])

    result = registry.dispatch("needs_db", {}, {})

    assert result == {
        "ok": False,
        "error": "missing tool dependencies: db_path",
        "tool": "needs_db",
    }


def test_default_tools_can_open_position_and_read_portfolio(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    registry = build_default_registry()
    broker = PaperBroker(db_path)
    deps = {
        "db_path": db_path,
        "order_executor": OrderExecutor(risk_gate=RiskGate(db_path), broker=broker),
    }

    opened = registry.dispatch(
        "open_position",
        {
            "trading_account_id": "trading-paper-default",
            "bot_id": "bot-default",
            "symbol": "BTC/USDT:USDT",
            "side": "buy",
            "position_side": "long",
            "quantity": 0.001,
            "leverage": 1,
            "mark_price": 50_000,
        },
        deps,
    )

    assert opened["ok"] is True
    assert opened["result"]["status"] == "filled"
    portfolio = registry.dispatch(
        "get_portfolio",
        {"trading_account_id": "trading-paper-default", "bot_id": "bot-default"},
        deps,
    )
    assert portfolio["ok"] is True
    assert portfolio["result"]["allocation"]["capital"] == 2000
    assert portfolio["result"]["positions"][0]["symbol"] == "BTC/USDT:USDT"
    assert portfolio["result"]["positions"][0]["quantity"] == 0.001


def test_strategy_tools_create_and_validate_package(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    registry = build_default_registry()
    deps = {"strategy_validation_service": StrategyValidationService(db_path)}

    created = registry.dispatch(
        "create_strategy_package",
        {
            "bot_id": "bot-default",
            "symbol": "BTC/USDT:USDT",
            "timeframe": "1h",
            "name": "BTC breakout",
            "entry_conditions": [{"indicator": "price", "operator": ">", "value": 100}],
            "exit_conditions": [{"indicator": "price", "operator": "<", "value": 98}],
        },
        deps,
    )

    assert created["ok"] is True
    validated = registry.dispatch(
        "validate_strategy",
        {
            "package_id": created["result"]["package_id"],
            "candles": [
                {"timestamp": "2026-01-01T00:00:00Z", "open": 99, "high": 100, "low": 98, "close": 99, "volume": 10},
                {"timestamp": "2026-01-01T01:00:00Z", "open": 100, "high": 103, "low": 99, "close": 102, "volume": 11},
                {"timestamp": "2026-01-01T02:00:00Z", "open": 103, "high": 104, "low": 96, "close": 97, "volume": 12},
            ],
        },
        deps,
    )

    assert validated["ok"] is True
    assert validated["result"]["status"] == "passed"
    assert validated["result"]["metrics"]["trade_count"] == 1
