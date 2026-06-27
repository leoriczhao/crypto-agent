from crypto_agent.domain.orders import OrderRequest
from crypto_agent.trading.live_exchange import LiveExchange


class FakeOKXClient:
    def __init__(self):
        self.loaded = False
        self.leverage_calls = []
        self.order_calls = []

    def load_markets(self):
        self.loaded = True
        return {}

    def set_leverage(self, leverage, symbol, params=None):
        self.leverage_calls.append((leverage, symbol, params or {}))
        return {"leverage": leverage}

    def create_order(self, symbol, order_type, side, amount, price=None, params=None):
        self.order_calls.append((symbol, order_type, side, amount, price, params or {}))
        return {"id": "live-order-1", "status": "open", "symbol": symbol}


def test_live_exchange_sets_leverage_and_places_okx_swap_open_order():
    client = FakeOKXClient()
    exchange = LiveExchange(client=client, margin_mode="isolated")

    result = exchange.create_market_order(
        OrderRequest(
            trading_account_id="trading-live",
            bot_id="bot-live",
            symbol="BTC/USDT:USDT",
            side="buy",
            position_side="long",
            quantity=0.01,
            leverage=5,
        )
    )

    assert client.loaded is True
    assert client.leverage_calls == [(5.0, "BTC/USDT:USDT", {"mgnMode": "isolated"})]
    assert client.order_calls == [
        (
            "BTC/USDT:USDT",
            "market",
            "buy",
            0.01,
            None,
            {"tdMode": "isolated", "posSide": "long", "reduceOnly": False},
        )
    ]
    assert result["id"] == "live-order-1"


def test_live_exchange_marks_reduce_only_when_order_reduces_position():
    client = FakeOKXClient()
    exchange = LiveExchange(client=client, margin_mode="cross")

    exchange.create_market_order(
        OrderRequest(
            trading_account_id="trading-live",
            bot_id="bot-live",
            symbol="ETH/USDT:USDT",
            side="sell",
            position_side="long",
            quantity=0.1,
            leverage=3,
        )
    )

    assert client.order_calls[0][5] == {"tdMode": "cross", "posSide": "long", "reduceOnly": True}
