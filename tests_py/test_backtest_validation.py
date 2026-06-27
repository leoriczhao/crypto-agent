import sqlite3

import pytest

from crypto_agent.backtest.validators import StrategyDeploymentError, StrategyValidationService
from crypto_agent.db.schema import initialize_database
from crypto_agent.domain.strategy import Candle, Condition, SignalStrategyDefinition, StrategyPackageRequest


def table_count(db_path, table):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(f"select count(*) from {table}").fetchone()[0]


def test_strategy_package_cannot_deploy_without_passed_validation(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    service = StrategyValidationService(db_path)
    package_id = service.create_package(
        StrategyPackageRequest(
            bot_id="bot-default",
            resident_agent_id=None,
            symbol="BTC/USDT:USDT",
            timeframe="1h",
            name="BTC breakout",
            definition=SignalStrategyDefinition(
                entry_conditions=[Condition(indicator="price", operator=">", value=100)],
                exit_conditions=[Condition(indicator="price", operator="<", value=95)],
            ),
        )
    )

    with pytest.raises(StrategyDeploymentError, match="without passed validation"):
        service.deploy_package(
            package_id,
            trading_account_id="trading-paper-default",
            allocated_capital=500,
            mode="paper",
        )

    assert table_count(db_path, "strategy_deployments") == 0


def test_passed_validation_allows_paper_deployment_and_persists_report(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    service = StrategyValidationService(db_path)
    package_id = service.create_package(
        StrategyPackageRequest(
            bot_id="bot-default",
            resident_agent_id=None,
            symbol="BTC/USDT:USDT",
            timeframe="1h",
            name="BTC breakout",
            definition=SignalStrategyDefinition(
                entry_conditions=[Condition(indicator="price", operator=">", value=100)],
                exit_conditions=[Condition(indicator="price", operator="<", value=98)],
            ),
        )
    )

    report = service.validate_package(
        package_id,
        candles=[
            Candle(timestamp="2026-01-01T00:00:00Z", open=99, high=100, low=98, close=99, volume=10),
            Candle(timestamp="2026-01-01T01:00:00Z", open=100, high=103, low=99, close=102, volume=11),
            Candle(timestamp="2026-01-01T02:00:00Z", open=102, high=104, low=100, close=103, volume=12),
            Candle(timestamp="2026-01-01T03:00:00Z", open=103, high=104, low=96, close=97, volume=13),
        ],
    )

    assert report.status == "passed"
    assert report.metrics["trade_count"] == 1
    assert report.metrics["realized_pnl"] == -5
    deployment_id = service.deploy_package(
        package_id,
        trading_account_id="trading-paper-default",
        allocated_capital=500,
        mode="paper",
    )

    assert deployment_id.startswith("strategy-deployment-")
    assert table_count(db_path, "strategy_validations") == 1
    assert table_count(db_path, "strategy_deployments") == 1
