from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from crypto_agent.backtest.engine import BacktestEngine
from crypto_agent.domain.strategy import BacktestReport, Candle, Condition, SignalStrategyDefinition, StrategyPackageRequest


class StrategyDeploymentError(RuntimeError):
    pass


class StrategyValidationService:
    def __init__(self, db_path: str | Path, *, engine: BacktestEngine | None = None):
        self.db_path = Path(db_path)
        self.engine = engine or BacktestEngine()

    def create_package(self, request: StrategyPackageRequest) -> str:
        package_id = f"strategy-package-{uuid.uuid4()}"
        with self._connect() as conn:
            conn.execute(
                """
                insert into strategy_packages (
                  id, bot_id, resident_agent_id, symbol, timeframe, name,
                  kind, status, definition_json
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    package_id,
                    request.bot_id,
                    request.resident_agent_id,
                    request.symbol,
                    request.timeframe,
                    request.name,
                    request.kind,
                    "draft",
                    json.dumps(asdict(request.definition), ensure_ascii=False),
                ),
            )
        return package_id

    def validate_package(self, package_id: str, *, candles: list[Candle]) -> BacktestReport:
        package = self._fetch_package(package_id)
        definition = _definition_from_json(package["definition_json"])
        report = self.engine.run_signal_strategy(definition, candles)

        validation_id = f"strategy-validation-{uuid.uuid4()}"
        with self._connect() as conn:
            conn.execute(
                """
                insert into strategy_validations (
                  id, package_id, status, report_json, metrics_json
                ) values (?, ?, ?, ?, ?)
                """,
                (
                    validation_id,
                    package_id,
                    report.status,
                    json.dumps(asdict(report), ensure_ascii=False),
                    json.dumps(report.metrics, ensure_ascii=False),
                ),
            )
            conn.execute(
                """
                update strategy_packages
                set status = ?, updated_at = datetime('now')
                where id = ?
                """,
                ("validated" if report.status == "passed" else "rejected", package_id),
            )
        return report

    def deploy_package(
        self,
        package_id: str,
        *,
        trading_account_id: str,
        allocated_capital: float,
        mode: Literal["paper", "live"] = "paper",
    ) -> str:
        package = self._fetch_package(package_id)
        if not self._has_passed_validation(package_id):
            raise StrategyDeploymentError("cannot deploy strategy package without passed validation")

        deployment_id = f"strategy-deployment-{uuid.uuid4()}"
        with self._connect() as conn:
            conn.execute(
                """
                insert into strategy_deployments (
                  id, package_id, bot_id, trading_account_id, status, mode, allocated_capital
                ) values (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    deployment_id,
                    package_id,
                    package["bot_id"],
                    trading_account_id,
                    "active",
                    mode,
                    allocated_capital,
                ),
            )
            conn.execute(
                """
                update strategy_packages
                set status = 'deployed', updated_at = datetime('now')
                where id = ?
                """,
                (package_id,),
            )
        return deployment_id

    def _fetch_package(self, package_id: str) -> sqlite3.Row:
        with self._connect() as conn:
            row = conn.execute(
                "select * from strategy_packages where id = ?",
                (package_id,),
            ).fetchone()
        if row is None:
            raise KeyError(f"strategy package not found: {package_id}")
        return row

    def _has_passed_validation(self, package_id: str) -> bool:
        with self._connect() as conn:
            count = conn.execute(
                """
                select count(*)
                from strategy_validations
                where package_id = ? and status = 'passed'
                """,
                (package_id,),
            ).fetchone()[0]
        return count > 0

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma foreign_keys = on")
        return conn


def _definition_from_json(payload: str) -> SignalStrategyDefinition:
    data = json.loads(payload)
    return SignalStrategyDefinition(
        entry_conditions=[Condition(**condition) for condition in data["entry_conditions"]],
        exit_conditions=[Condition(**condition) for condition in data["exit_conditions"]],
    )
