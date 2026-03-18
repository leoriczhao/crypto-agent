import uuid
from datetime import datetime
from .live import LiveExchange
from .base import BaseExchange


class PaperExchange(BaseExchange):
    def __init__(self, exchange_id: str = "binance", initial_balance: dict | None = None):
        self._live = LiveExchange(exchange_id)
        self._balance: dict[str, float] = dict(initial_balance or {"USDT": 10000.0})
        self._orders: list[dict] = []
        self._positions: dict[str, dict] = {}

    async def fetch_ticker(self, symbol: str) -> dict:
        return await self._live.fetch_ticker(symbol)

    async def fetch_ohlcv(self, symbol: str, timeframe: str = "1h", limit: int = 24) -> list[dict]:
        return await self._live.fetch_ohlcv(symbol, timeframe, limit)

    async def fetch_order_book(self, symbol: str, limit: int = 10) -> dict:
        return await self._live.fetch_order_book(symbol, limit)

    async def create_order(self, symbol: str, side: str, order_type: str, amount: float, price: float | None = None) -> dict:
        ticker = await self._live.fetch_ticker(symbol)
        exec_price = price if (order_type == "limit" and price) else ticker["last"]
        base, quote = symbol.split("/")

        if side == "buy":
            cost = exec_price * amount
            if self._balance.get(quote, 0) < cost:
                return {"error": f"Insufficient {quote}: need {cost:.2f}, have {self._balance.get(quote, 0):.2f}"}
            self._balance[quote] -= cost
            self._balance[base] = self._balance.get(base, 0) + amount
        else:
            if self._balance.get(base, 0) < amount:
                return {"error": f"Insufficient {base}: need {amount}, have {self._balance.get(base, 0)}"}
            self._balance[base] -= amount
            self._balance[quote] = self._balance.get(quote, 0) + exec_price * amount

        order_id = str(uuid.uuid4())[:8]
        order = {"id": order_id, "symbol": symbol, "side": side, "type": order_type,
                 "amount": amount, "price": exec_price, "status": "filled",
                 "created_at": datetime.now().isoformat()}
        self._orders.append(order)
        self._update_position(symbol, side, amount, exec_price)
        return order

    def _update_position(self, symbol: str, side: str, amount: float, price: float):
        pos = self._positions.get(symbol, {"symbol": symbol, "amount": 0, "avg_entry_price": 0})
        if side == "buy":
            total_cost = pos["avg_entry_price"] * pos["amount"] + price * amount
            pos["amount"] += amount
            pos["avg_entry_price"] = total_cost / pos["amount"] if pos["amount"] > 0 else 0
        else:
            pos["amount"] -= amount
            if pos["amount"] <= 1e-10:
                self._positions.pop(symbol, None)
                return
        self._positions[symbol] = pos

    async def cancel_order(self, order_id: str, symbol: str) -> dict:
        return {"error": "Paper trading: market orders fill immediately"}

    async def fetch_balance(self) -> dict:
        return {k: {"free": v, "used": 0, "total": v} for k, v in self._balance.items() if v > 1e-10}

    async def fetch_open_orders(self, symbol: str | None = None) -> list[dict]:
        return []

    async def fetch_positions(self) -> dict:
        result = {}
        for sym, pos in self._positions.items():
            try:
                ticker = await self._live.fetch_ticker(sym)
                pos["current_price"] = ticker["last"]
                pos["unrealized_pnl"] = round((ticker["last"] - pos["avg_entry_price"]) * pos["amount"], 2)
            except Exception:
                pos["current_price"] = pos["avg_entry_price"]
                pos["unrealized_pnl"] = 0
            result[sym] = pos
        return result

    async def close(self):
        await self._live.close()
