from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

OrderSide = Literal["buy", "sell"]
PositionSide = Literal["long", "short"]


@dataclass(frozen=True)
class OrderRequest:
    trading_account_id: str
    bot_id: str
    symbol: str
    side: OrderSide
    position_side: PositionSide
    quantity: float
    leverage: float = 1.0
    resident_agent_id: str | None = None

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
        if self.leverage <= 0:
            raise ValueError("leverage must be positive")


@dataclass(frozen=True)
class ExecutedOrder:
    order_id: str
    fill_id: str
    status: str
    realized_pnl: float


@dataclass(frozen=True)
class Position:
    id: str
    trading_account_id: str
    bot_id: str
    symbol: str
    position_side: PositionSide
    quantity: float
    entry_price: float
    mark_price: float
    realized_pnl: float
    unrealized_pnl: float
