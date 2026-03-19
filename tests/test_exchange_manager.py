import pytest
from crypto_agent.exchange.manager import ExchangeManager


class FakeExchange:
    def __init__(self, name):
        self.name = name
        self.closed = False
    async def fetch_ticker(self, symbol):
        return {"symbol": symbol, "last": 100.0, "bid": 99, "ask": 101}
    async def close(self):
        self.closed = True


def test_manager_active_exchange():
    mgr = ExchangeManager()
    mgr.register("gateio", FakeExchange("gateio"))
    mgr.register("okx", FakeExchange("okx"))
    mgr.set_active("gateio")
    assert mgr.active.name == "gateio"


def test_manager_switch_exchange():
    mgr = ExchangeManager()
    mgr.register("gateio", FakeExchange("gateio"))
    mgr.register("okx", FakeExchange("okx"))
    mgr.set_active("gateio")
    mgr.set_active("okx")
    assert mgr.active.name == "okx"


def test_manager_list_exchanges():
    mgr = ExchangeManager()
    mgr.register("gateio", FakeExchange("gateio"))
    mgr.register("okx", FakeExchange("okx"))
    assert sorted(mgr.list()) == ["gateio", "okx"]


def test_manager_get_specific():
    mgr = ExchangeManager()
    mgr.register("gateio", FakeExchange("gateio"))
    assert mgr.get("gateio").name == "gateio"


def test_manager_switch_unknown_raises():
    mgr = ExchangeManager()
    mgr.register("gateio", FakeExchange("gateio"))
    with pytest.raises(KeyError):
        mgr.set_active("nonexistent")


@pytest.mark.asyncio
async def test_manager_close_all():
    mgr = ExchangeManager()
    ex1 = FakeExchange("a")
    ex2 = FakeExchange("b")
    mgr.register("a", ex1)
    mgr.register("b", ex2)
    await mgr.close_all()
    assert ex1.closed and ex2.closed
