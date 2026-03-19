import json
import pytest
from unittest.mock import patch, MagicMock
from crypto_agent.tools.chain_data import (
    handle_chain_data,
    _fetch_json,
    _format_number,
)


def test_format_number_thousands():
    assert _format_number(5000) == "5.0K"

def test_format_number_millions():
    assert _format_number(2500000) == "2.50M"

def test_format_number_billions():
    assert _format_number(7000000000) == "7.00B"

def test_format_number_small():
    assert _format_number(42) == "42"


def test_fetch_json_returns_dict():
    with patch("crypto_agent.tools.chain_data.urlopen") as mock_urlopen:
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"key": "value"}'
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp
        result = _fetch_json("https://example.com/api")
        assert result == {"key": "value"}


@pytest.mark.asyncio
async def test_chain_data_network_stats_bitcoin():
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
    with patch("crypto_agent.tools.chain_data._fetch_json", return_value=fake_stats):
        result = await handle_chain_data(exchange=None, action="network_stats", chain="bitcoin")
        assert "Bitcoin Network Stats" in result
        assert "85,000.00" in result


@pytest.mark.asyncio
async def test_chain_data_fees_bitcoin():
    fake_fees = {"fastestFee": 20, "halfHourFee": 15, "hourFee": 10, "economyFee": 7, "minimumFee": 5}
    with patch("crypto_agent.tools.chain_data._fetch_json", return_value=fake_fees):
        result = await handle_chain_data(exchange=None, action="fees", chain="bitcoin")
        assert "sat/vB" in result
        assert "20" in result


@pytest.mark.asyncio
async def test_chain_data_network_stats_ethereum():
    fake_data = {"data": {"market_price_usd": 3200, "transactions_24h": 1100000, "difficulty": 0, "blocks_24h": 7200, "mempool_transactions": 15000, "average_block_time": 12.1}}
    with patch("crypto_agent.tools.chain_data._fetch_json", return_value=fake_data):
        result = await handle_chain_data(exchange=None, action="network_stats", chain="ethereum")
        assert "Ethereum" in result


@pytest.mark.asyncio
async def test_chain_data_unknown_action():
    result = await handle_chain_data(exchange=None, action="nonexistent")
    assert "Unknown" in result


@pytest.mark.asyncio
async def test_chain_data_api_error():
    from urllib.error import URLError
    with patch("crypto_agent.tools.chain_data._fetch_json", side_effect=URLError("timeout")):
        result = await handle_chain_data(exchange=None, action="network_stats")
        assert "Error" in result
