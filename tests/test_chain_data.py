import pytest
from unittest.mock import patch, MagicMock
from crypto_agent.tools.get_chain_stats import handle_get_chain_stats


@pytest.mark.asyncio
async def test_chain_stats_bitcoin():
    fake_stats = {
        "market_price_usd": 85000.0,
        "hash_rate": 700000000.0,
        "n_tx": 400000,
        "mempool_size": 5000,
        "difficulty": 80000000000000,
        "n_blocks_mined": 144,
        "totalbc": 1960000000000000,
        "minutes_between_blocks": 10.2,
    }
    fake_fees = {"fastestFee": 20, "halfHourFee": 15, "hourFee": 10, "economyFee": 7, "minimumFee": 5}
    with patch("crypto_agent.tools.get_chain_stats._fetch_json", side_effect=[fake_stats, fake_fees]):
        result = await handle_get_chain_stats(exchange=None, chain="bitcoin")
        assert "Bitcoin" in result
        assert "85,000.00" in result
        assert "sat/vB" in result


@pytest.mark.asyncio
async def test_chain_stats_ethereum():
    fake_data = {"data": {
        "market_price_usd": 3200, "transactions_24h": 1100000,
        "difficulty": 0, "blocks_24h": 7200,
        "mempool_transactions": 15000, "average_block_time": 12.1,
        "median_transaction_fee_usd_24h": 2.5,
    }}
    with patch("crypto_agent.tools.get_chain_stats._fetch_json", return_value=fake_data):
        result = await handle_get_chain_stats(exchange=None, chain="ethereum")
        assert "Ethereum" in result


@pytest.mark.asyncio
async def test_chain_stats_api_error():
    from urllib.error import URLError
    with patch("crypto_agent.tools.get_chain_stats._fetch_json", side_effect=URLError("timeout")):
        result = await handle_get_chain_stats(exchange=None)
        assert "Error" in result
