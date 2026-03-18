from abc import ABC, abstractmethod


class BaseExchange(ABC):
    @abstractmethod
    async def fetch_ticker(self, symbol: str) -> dict: ...

    @abstractmethod
    async def fetch_ohlcv(self, symbol: str, timeframe: str = "1h", limit: int = 24) -> list[dict]: ...

    @abstractmethod
    async def fetch_order_book(self, symbol: str, limit: int = 10) -> dict: ...

    @abstractmethod
    async def create_order(self, symbol: str, side: str, order_type: str, amount: float, price: float | None = None) -> dict: ...

    @abstractmethod
    async def cancel_order(self, order_id: str, symbol: str) -> dict: ...

    @abstractmethod
    async def fetch_balance(self) -> dict: ...

    @abstractmethod
    async def fetch_open_orders(self, symbol: str | None = None) -> list[dict]: ...
