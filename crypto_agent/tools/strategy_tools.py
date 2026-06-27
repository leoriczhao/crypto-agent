from __future__ import annotations

from dataclasses import asdict
from typing import Any

from crypto_agent.domain.strategy import Candle, Condition, SignalStrategyDefinition, StrategyPackageRequest


def create_strategy_package(args: dict[str, Any], deps: dict[str, Any]) -> dict[str, str]:
    definition = SignalStrategyDefinition(
        entry_conditions=[Condition(**condition) for condition in args["entry_conditions"]],
        exit_conditions=[Condition(**condition) for condition in args["exit_conditions"]],
    )
    package_id = deps["strategy_validation_service"].create_package(
        StrategyPackageRequest(
            bot_id=args["bot_id"],
            resident_agent_id=args.get("resident_agent_id"),
            symbol=args["symbol"],
            timeframe=args["timeframe"],
            name=args["name"],
            definition=definition,
        )
    )
    return {"package_id": package_id}


def validate_strategy(args: dict[str, Any], deps: dict[str, Any]) -> dict[str, Any]:
    report = deps["strategy_validation_service"].validate_package(
        args["package_id"],
        candles=[Candle(**candle) for candle in args["candles"]],
    )
    return asdict(report)


def deploy_strategy(args: dict[str, Any], deps: dict[str, Any]) -> dict[str, str]:
    deployment_id = deps["strategy_validation_service"].deploy_package(
        args["package_id"],
        trading_account_id=args["trading_account_id"],
        allocated_capital=float(args["allocated_capital"]),
        mode=args.get("mode", "paper"),
    )
    return {"deployment_id": deployment_id}
