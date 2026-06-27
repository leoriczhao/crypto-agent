from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


Operator = Literal[">", ">=", "<", "<=", "==", "!="]


@dataclass(frozen=True)
class Condition:
    indicator: str
    operator: Operator
    value: float
    period: int | None = None


@dataclass(frozen=True)
class SignalStrategyDefinition:
    entry_conditions: list[Condition]
    exit_conditions: list[Condition]


@dataclass(frozen=True)
class StrategyPackageRequest:
    bot_id: str
    resident_agent_id: str | None
    symbol: str
    timeframe: str
    name: str
    definition: SignalStrategyDefinition
    kind: str = "signal"


@dataclass(frozen=True)
class Candle:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class BacktestReport:
    status: Literal["passed", "failed"]
    metrics: dict[str, float | int]
    trades: list[dict[str, float | str]]
