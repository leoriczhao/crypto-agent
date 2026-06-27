from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Sequence
from typing import Any

from .config import Settings
from .db.schema import initialize_database


def build_health_payload(settings: Settings) -> dict[str, Any]:
    return {
        "status": "ok",
        "runtime": "python",
        "environment": settings.environment,
        "database_path": str(settings.database_path),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "health":
        settings = Settings(
            database_path=Path(args.database_path),
            environment=args.environment,
        )
        print(json.dumps(build_health_payload(settings), ensure_ascii=False))
        return 0

    if args.command == "init-db":
        initialize_database(Path(args.database_path), destructive=args.destructive)
        print(
            json.dumps(
                {
                    "status": "initialized",
                    "runtime": "python",
                    "database_path": str(args.database_path),
                    "destructive": args.destructive,
                },
                ensure_ascii=False,
            )
        )
        return 0

    if args.command == "smoke":
        payload = run_closed_loop_smoke(
            database_path=Path(args.database_path),
            profile_path=Path(args.profile_path),
            destructive=args.destructive,
        )
        print(json.dumps(payload, ensure_ascii=False))
        return 0

    if args.command == "daemon":
        if args.init_db or args.destructive:
            initialize_database(Path(args.database_path), destructive=args.destructive)
        return run_daemon(
            Settings(
                database_path=Path(args.database_path),
                environment=args.environment,
            ),
            socket_path=Path(args.socket_path),
        )

    parser.print_help()
    return 2


def run_closed_loop_smoke(
    *,
    database_path: Path,
    profile_path: Path,
    destructive: bool,
) -> dict[str, Any]:
    from crypto_agent.agents.resident_runtime import ResidentRuntime
    from crypto_agent.backtest.validators import StrategyValidationService
    from crypto_agent.tools.registry import build_default_registry
    from crypto_agent.trading.order_executor import OrderExecutor
    from crypto_agent.trading.paper_broker import PaperBroker
    from crypto_agent.trading.risk_gate import RiskGate

    initialize_database(database_path, destructive=destructive)
    broker = PaperBroker(database_path)
    validation_service = StrategyValidationService(database_path)
    runtime = ResidentRuntime(
        database_path,
        tool_registry=build_default_registry(),
        deps={
            "db_path": database_path,
            "strategy_validation_service": validation_service,
            "order_executor": OrderExecutor(risk_gate=RiskGate(database_path), broker=broker),
        },
    )
    researcher_id = runtime.spawn_resident(
        type="researcher",
        name="Smoke Researcher",
        profile_path=profile_path,
        bot_id="bot-default",
    )
    research_state = runtime.run_once(
        researcher_id,
        {
            "symbol": "BTC/USDT:USDT",
            "timeframe": "1h",
            "name": "BTC smoke breakout",
            "entry_conditions": [{"indicator": "price", "operator": ">", "value": 100}],
            "exit_conditions": [{"indicator": "price", "operator": "<", "value": 98}],
            "candles": [
                {"timestamp": "2026-01-01T00:00:00Z", "open": 99, "high": 100, "low": 98, "close": 99, "volume": 10},
                {"timestamp": "2026-01-01T01:00:00Z", "open": 100, "high": 103, "low": 99, "close": 102, "volume": 11},
                {"timestamp": "2026-01-01T02:00:00Z", "open": 103, "high": 104, "low": 96, "close": 97, "volume": 12},
            ],
        },
    )
    trader_id = runtime.spawn_resident(
        type="trader",
        name="Smoke Trader",
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
    close_state = runtime.run_once(
        trader_id,
        {
            "trading_account_id": "trading-paper-default",
            "symbol": "BTC/USDT:USDT",
            "side": "sell",
            "position_side": "long",
            "quantity": 0.001,
            "leverage": 1,
            "mark_price": 51_000,
        },
    )
    return {
        "status": "ok",
        "runtime": "python",
        "database_path": str(database_path),
        "researcher_outcome": research_state["outcome"],
        "strategy_package_id": research_state["package_id"],
        "trader_outcome": trader_state["outcome"],
        "strategy_deployment_id": trader_state.get("strategy_deployment_id"),
        "paper_order_status": trader_state["order_result"]["status"],
        "close_order_status": close_state["order_result"]["status"],
        "realized_pnl": close_state["order_result"]["realized_pnl"],
    }


def run_daemon(settings: Settings, *, socket_path: Path) -> int:
    from crypto_agent.ipc.server import CryptoAgentIpcServer

    server = CryptoAgentIpcServer(settings=settings, socket_path=socket_path)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


def console_main() -> None:
    raise SystemExit(main())


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="crypto-agent-py")
    subparsers = parser.add_subparsers(dest="command", required=True)

    health = subparsers.add_parser("health")
    health.add_argument("--database-path", default=Settings.from_env().database_path)
    health.add_argument("--environment", default=Settings.from_env().environment)

    init_db = subparsers.add_parser("init-db")
    init_db.add_argument("--database-path", default=Settings.from_env().database_path)
    init_db.add_argument("--destructive", action="store_true")

    smoke = subparsers.add_parser("smoke")
    smoke.add_argument("--database-path", default=Settings.from_env().database_path)
    smoke.add_argument("--profile-path", required=True)
    smoke.add_argument("--destructive", action="store_true")

    daemon = subparsers.add_parser("daemon")
    daemon.add_argument("--database-path", default=Settings.from_env().database_path)
    daemon.add_argument("--environment", default=Settings.from_env().environment)
    daemon.add_argument(
        "--socket-path",
        default=os.getenv("CRYPTO_AGENT_SOCK", "/tmp/crypto-agent-py.sock"),
    )
    daemon.add_argument("--init-db", action="store_true")
    daemon.add_argument("--destructive", action="store_true")

    return parser


if __name__ == "__main__":
    console_main()
