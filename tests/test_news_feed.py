import pytest
from unittest.mock import patch
from crypto_agent.tools.get_news import handle_get_news


@pytest.mark.asyncio
async def test_get_news_headlines():
    fake_headlines = [
        {"title": "Bitcoin surge to new high", "url": "", "published": "2024-01-01"},
        {"title": "ETH rally continues", "url": "", "published": "2024-01-01"},
    ]
    with patch("crypto_agent.tools.get_news._fetch_cryptopanic", return_value=fake_headlines):
        result = await handle_get_news(exchange=None, symbol="BTC")
        assert "Bitcoin" in result or "BTC" in result
        assert "surge" in result.lower() or "rally" in result.lower()
