from .base import BaseExchange


class ExchangeManager:
    def __init__(self):
        self._exchanges: dict[str, BaseExchange] = {}
        self._active_id: str | None = None

    def register(self, exchange_id: str, exchange: BaseExchange):
        self._exchanges[exchange_id] = exchange
        if self._active_id is None:
            self._active_id = exchange_id

    @property
    def active(self) -> BaseExchange:
        if self._active_id is None or self._active_id not in self._exchanges:
            raise RuntimeError("No active exchange. Register one first.")
        return self._exchanges[self._active_id]

    @property
    def active_id(self) -> str:
        return self._active_id or ""

    def set_active(self, exchange_id: str):
        if exchange_id not in self._exchanges:
            raise KeyError(f"Exchange '{exchange_id}' not registered. Available: {list(self._exchanges.keys())}")
        self._active_id = exchange_id

    def get(self, exchange_id: str) -> BaseExchange:
        if exchange_id not in self._exchanges:
            raise KeyError(f"Exchange '{exchange_id}' not registered.")
        return self._exchanges[exchange_id]

    def list(self) -> list[str]:
        return list(self._exchanges.keys())

    async def close_all(self):
        for ex in self._exchanges.values():
            await ex.close()
