import asyncio
import json
import pytest
from crypto_agent.exchange.paper import PaperExchange
from crypto_agent.tools.market_data import handle_market_data
from crypto_agent.tools.execute_trade import handle_execute_trade
from crypto_agent.tools.portfolio import handle_portfolio
from crypto_agent.config import Config


@pytest.fixture
def exchange():
    return PaperExchange(exchange_id="gateio", initial_balance={"USDT": 10000.0})


@pytest.fixture
def test_config():
    return Config(paper_trading=True, max_order_size_usdt=1000.0)


@pytest.mark.asyncio
async def test_market_data_ticker(exchange):
    result = await handle_market_data(exchange, action="ticker", symbol="BTC/USDT")
    data = json.loads(result)
    assert "last" in data
    assert data["last"] > 0
    await exchange.close()


@pytest.mark.asyncio
async def test_execute_buy(exchange, test_config):
    result = await handle_execute_trade(exchange, test_config, action="buy",
                                        symbol="BTC/USDT", amount=0.001, order_type="market")
    assert "PAPER" in result
    assert "filled" in result.lower()
    await exchange.close()


@pytest.mark.asyncio
async def test_execute_trade_too_large(exchange, test_config):
    result = await handle_execute_trade(exchange, test_config, action="buy",
                                        symbol="BTC/USDT", amount=100, order_type="market")
    assert "exceeds max" in result
    await exchange.close()


@pytest.mark.asyncio
async def test_portfolio_balance(exchange):
    result = await handle_portfolio(exchange, action="balance")
    assert "USDT" in result
    await exchange.close()


@pytest.mark.asyncio
async def test_portfolio_positions_empty(exchange):
    result = await handle_portfolio(exchange, action="positions")
    assert "No open positions" in result
    await exchange.close()
