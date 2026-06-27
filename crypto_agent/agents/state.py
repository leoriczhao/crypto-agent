from __future__ import annotations

from typing import Any, TypedDict


class ResearcherGraphState(TypedDict, total=False):
    tool_registry: Any
    deps: dict[str, Any]
    bot_id: str
    resident_agent_id: str | None
    symbol: str
    timeframe: str
    name: str
    entry_conditions: list[dict[str, Any]]
    exit_conditions: list[dict[str, Any]]
    candles: list[dict[str, Any]]
    package_id: str
    validation: dict[str, Any]
    outcome: str


class TraderGraphState(TypedDict, total=False):
    tool_registry: Any
    deps: dict[str, Any]
    trading_account_id: str
    bot_id: str
    symbol: str
    side: str
    position_side: str
    quantity: float
    leverage: float
    mark_price: float
    strategy_package_id: str
    allocated_capital: float
    strategy_deployment_id: str
    portfolio_before: dict[str, Any]
    order_result: dict[str, Any]
    portfolio_after: dict[str, Any]
    outcome: str


class MainGraphState(TypedDict, total=False):
    message: str
    response: str
