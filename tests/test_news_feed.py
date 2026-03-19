import pytest
from crypto_agent.exchange.paper import PaperExchange
from crypto_agent.tools.news_feed import handle_news_feed


@pytest.mark.asyncio
async def test_news_feed_headlines():
    exchange = PaperExchange(exchange_id="gateio", initial_balance={"USDT": 10000.0})
    result = await handle_news_feed(exchange, action="headlines", symbol="BTC", limit=3)
    assert len(result) > 0
    await exchange.close()
