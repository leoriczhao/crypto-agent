import json
import pytest
from crypto_agent.exchange.paper import PaperExchange
from crypto_agent.tools.get_price import handle_get_price
from crypto_agent.tools.buy import handle_buy
from crypto_agent.tools.sell import handle_sell
from crypto_agent.tools.get_portfolio import handle_get_portfolio
from crypto_agent.config import Config


@pytest.fixture
def exchange():
    return PaperExchange(exchange_id="gateio", initial_balance={"USDT": 10000.0})


@pytest.fixture
def test_config():
    return Config(paper_trading=True, max_order_size_usdt=1000.0)


@pytest.mark.asyncio
async def test_get_price(exchange):
    result = await handle_get_price(exchange, symbol="BTC/USDT")
    data = json.loads(result)
    assert "last" in data
    assert data["last"] > 0
    await exchange.close()


@pytest.mark.asyncio
async def test_buy(exchange, test_config):
    result = await handle_buy(exchange, test_config, symbol="BTC/USDT", amount=0.001)
    assert "PAPER" in result
    assert "filled" in result.lower() or "Buy order" in result
    await exchange.close()


@pytest.mark.asyncio
async def test_buy_too_large(exchange, test_config):
    result = await handle_buy(exchange, test_config, symbol="BTC/USDT", amount=100)
    assert "exceeds max" in result
    await exchange.close()


@pytest.mark.asyncio
async def test_get_portfolio_balance(exchange):
    result = await handle_get_portfolio(exchange)
    assert "USDT" in result
    await exchange.close()


@pytest.mark.asyncio
async def test_get_portfolio_no_positions(exchange):
    result = await handle_get_portfolio(exchange)
    assert "No open positions" in result
    await exchange.close()
