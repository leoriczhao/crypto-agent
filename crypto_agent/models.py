from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"


class OrderStatus(str, Enum):
    OPEN = "open"
    FILLED = "filled"
    CANCELED = "canceled"
    FAILED = "failed"


@dataclass
class Order:
    id: str
    symbol: str
    side: Side
    order_type: OrderType
    amount: float
    price: float | None = None
    status: OrderStatus = OrderStatus.OPEN
    filled_price: float | None = None
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "side": self.side.value,
            "type": self.order_type.value,
            "amount": self.amount,
            "price": self.price,
            "filled_price": self.filled_price,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class Position:
    symbol: str
    amount: float
    avg_entry_price: float
    current_price: float = 0.0

    @property
    def unrealized_pnl(self) -> float:
        return (self.current_price - self.avg_entry_price) * self.amount

    @property
    def pnl_percent(self) -> float:
        if self.avg_entry_price == 0:
            return 0.0
        return (self.current_price - self.avg_entry_price) / self.avg_entry_price * 100

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "amount": self.amount,
            "avg_entry_price": self.avg_entry_price,
            "current_price": self.current_price,
            "unrealized_pnl": round(self.unrealized_pnl, 2),
            "pnl_percent": f"{self.pnl_percent:.2f}%",
        }
