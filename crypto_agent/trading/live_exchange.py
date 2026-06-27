from __future__ import annotations

from typing import Any, Literal

from crypto_agent.domain.orders import OrderRequest

MarginMode = Literal["cross", "isolated"]


class LiveExchange:
    def __init__(self, *, client: Any, margin_mode: MarginMode = "isolated"):
        self.client = client
        self.margin_mode = margin_mode
        self._markets_loaded = False

    @classmethod
    def okx(
        cls,
        *,
        api_key: str,
        secret: str,
        password: str,
        margin_mode: MarginMode = "isolated",
    ) -> "LiveExchange":
        import ccxt

        client = ccxt.okx(
            {
                "apiKey": api_key,
                "secret": secret,
                "password": password,
                "options": {"defaultType": "swap"},
            }
        )
        return cls(client=client, margin_mode=margin_mode)

    def create_market_order(self, request: OrderRequest, *, mark_price: float | None = None) -> dict[str, Any]:
        self._ensure_markets_loaded()
        self.client.set_leverage(
            float(request.leverage),
            request.symbol,
            {"mgnMode": self.margin_mode},
        )
        return self.client.create_order(
            request.symbol,
            "market",
            request.side,
            request.quantity,
            None,
            self._order_params(request),
        )

    def fetch_balance(self) -> dict[str, Any]:
        self._ensure_markets_loaded()
        return self.client.fetch_balance()

    def fetch_positions(self, symbols: list[str] | None = None) -> list[dict[str, Any]]:
        self._ensure_markets_loaded()
        return self.client.fetch_positions(symbols)

    def _order_params(self, request: OrderRequest) -> dict[str, Any]:
        return {
            "tdMode": self.margin_mode,
            "posSide": request.position_side,
            "reduceOnly": _is_reduce_only(request),
        }

    def _ensure_markets_loaded(self) -> None:
        if not self._markets_loaded:
            self.client.load_markets()
            self._markets_loaded = True


def _is_reduce_only(request: OrderRequest) -> bool:
    return (
        request.position_side == "long"
        and request.side == "sell"
        or request.position_side == "short"
        and request.side == "buy"
    )
