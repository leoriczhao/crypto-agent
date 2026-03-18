import pytest
from crypto_agent.exchange.paper import PaperExchange


@pytest.fixture
def paper():
    return PaperExchange(exchange_id="gateio", initial_balance={"USDT": 10000.0})


@pytest.mark.asyncio
async def test_initial_balance(paper):
    balance = await paper.fetch_balance()
    assert "USDT" in balance
    assert balance["USDT"]["total"] == 10000.0


@pytest.mark.asyncio
async def test_fetch_ticker(paper):
    ticker = await paper.fetch_ticker("BTC/USDT")
    assert "last" in ticker
    assert ticker["last"] > 0
    await paper.close()


@pytest.mark.asyncio
async def test_buy_and_check_balance(paper):
    ticker = await paper.fetch_ticker("BTC/USDT")
    buy_amount = 100.0 / ticker["last"]
    order = await paper.create_order("BTC/USDT", "buy", "market", buy_amount)
    assert order["status"] == "filled"
    balance = await paper.fetch_balance()
    assert "BTC" in balance
    assert balance["USDT"]["total"] < 10000.0
    await paper.close()


@pytest.mark.asyncio
async def test_insufficient_balance(paper):
    order = await paper.create_order("BTC/USDT", "buy", "market", 999999)
    assert "error" in order
    await paper.close()


@pytest.mark.asyncio
async def test_sell_order(paper):
    ticker = await paper.fetch_ticker("BTC/USDT")
    buy_amount = 100.0 / ticker["last"]
    await paper.create_order("BTC/USDT", "buy", "market", buy_amount)
    sell_order = await paper.create_order("BTC/USDT", "sell", "market", buy_amount)
    assert sell_order["status"] == "filled"
    await paper.close()
