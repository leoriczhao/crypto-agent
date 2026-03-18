import ccxt.async_support as ccxt
from .base import BaseExchange


class LiveExchange(BaseExchange):
    def __init__(self, exchange_id: str = "binance", api_key: str = "", secret: str = ""):
        exchange_class = getattr(ccxt, exchange_id)
        self.exchange = exchange_class({"apiKey": api_key, "secret": secret, "enableRateLimit": True})

    async def fetch_ticker(self, symbol: str) -> dict:
        t = await self.exchange.fetch_ticker(symbol)
        return {"symbol": t["symbol"], "last": t["last"], "bid": t["bid"], "ask": t["ask"],
                "high": t["high"], "low": t["low"], "volume": t.get("baseVolume"), "change_percent": t.get("percentage", 0)}

    async def fetch_ohlcv(self, symbol: str, timeframe: str = "1h", limit: int = 24) -> list[dict]:
        data = await self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
        return [{"timestamp": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]} for r in data]

    async def fetch_order_book(self, symbol: str, limit: int = 10) -> dict:
        book = await self.exchange.fetch_order_book(symbol, limit)
        return {"bids": book["bids"][:limit], "asks": book["asks"][:limit]}

    async def create_order(self, symbol: str, side: str, order_type: str, amount: float, price: float | None = None) -> dict:
        o = await self.exchange.create_order(symbol, order_type, side, amount, price)
        return {"id": o["id"], "symbol": o["symbol"], "side": o["side"], "type": o["type"], "amount": o["amount"], "price": o["price"], "status": o["status"]}

    async def cancel_order(self, order_id: str, symbol: str) -> dict:
        r = await self.exchange.cancel_order(order_id, symbol)
        return {"id": r["id"], "status": "canceled"}

    async def fetch_balance(self) -> dict:
        bal = await self.exchange.fetch_balance()
        return {k: v for k, v in bal.items() if isinstance(v, dict) and v.get("total", 0) > 0}

    async def fetch_open_orders(self, symbol: str | None = None) -> list[dict]:
        orders = await self.exchange.fetch_open_orders(symbol)
        return [{"id": o["id"], "symbol": o["symbol"], "side": o["side"], "type": o["type"], "amount": o["amount"], "price": o["price"]} for o in orders]

    async def close(self):
        await self.exchange.close()
