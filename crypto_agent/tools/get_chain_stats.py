import json
from urllib.request import urlopen, Request
from urllib.error import URLError
from .registry import register_tool

BLOCKCHAIN_INFO_STATS = "https://blockchain.info/stats?format=json"
BLOCKCHAIR_STATS = "https://api.blockchair.com/{chain}/stats"
MEMPOOL_FEES = "https://mempool.space/api/v1/fees/recommended"


def _fetch_json(url: str, timeout: int = 10) -> dict:
    req = Request(url, headers={"User-Agent": "CryptoAgent/0.1"})
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _format_number(n: float) -> str:
    if n >= 1e12:
        return f"{n / 1e12:.2f}T"
    if n >= 1e9:
        return f"{n / 1e9:.2f}B"
    if n >= 1e6:
        return f"{n / 1e6:.2f}M"
    if n >= 1e3:
        return f"{n / 1e3:.1f}K"
    return f"{n:.0f}"


def _get_network_stats(chain: str) -> list[str]:
    if chain == "bitcoin":
        data = _fetch_json(BLOCKCHAIN_INFO_STATS)
        return [
            "Bitcoin Network Stats",
            "=" * 40,
            f"Market Price:        ${data.get('market_price_usd', 0):,.2f}",
            f"Hash Rate:           {_format_number(data.get('hash_rate', 0))} GH/s",
            f"Difficulty:          {_format_number(data.get('difficulty', 0))}",
            f"24h Transactions:    {_format_number(data.get('n_tx', 0))}",
            f"Mempool Size:        {_format_number(data.get('mempool_size', 0))} txs",
            f"Blocks Mined (24h):  {data.get('n_blocks_mined', 0)}",
            f"Total BTC Mined:     {data.get('totalbc', 0) / 1e8:,.0f} BTC",
            f"Minutes Between Blocks: {data.get('minutes_between_blocks', 0):.1f}",
        ]
    elif chain == "ethereum":
        data = _fetch_json(BLOCKCHAIR_STATS.format(chain="ethereum"))
        stats = data.get("data", {})
        return [
            "Ethereum Network Stats",
            "=" * 40,
            f"Market Price:        ${stats.get('market_price_usd', 0):,.2f}",
            f"24h Transactions:    {_format_number(stats.get('transactions_24h', 0))}",
            f"Difficulty:          {_format_number(stats.get('difficulty', 0))}",
            f"Blocks (24h):        {_format_number(stats.get('blocks_24h', 0))}",
            f"Mempool TXs:         {_format_number(stats.get('mempool_transactions', 0))}",
            f"Average Block Time:  {stats.get('average_block_time', 0):.1f}s",
        ]
    return [f"Unsupported chain: {chain}"]


def _get_fees(chain: str) -> list[str]:
    if chain == "bitcoin":
        data = _fetch_json(MEMPOOL_FEES)
        return [
            "Bitcoin Fee Estimates (sat/vB)",
            "=" * 40,
            f"Fastest (~10 min):   {data.get('fastestFee', 'N/A')} sat/vB",
            f"Half Hour:           {data.get('halfHourFee', 'N/A')} sat/vB",
            f"Hour:                {data.get('hourFee', 'N/A')} sat/vB",
            f"Economy:             {data.get('economyFee', 'N/A')} sat/vB",
            f"Minimum:             {data.get('minimumFee', 'N/A')} sat/vB",
        ]
    elif chain == "ethereum":
        data = _fetch_json(BLOCKCHAIR_STATS.format(chain="ethereum"))
        stats = data.get("data", {})
        median_fee = stats.get("median_transaction_fee_usd_24h", "N/A")
        return [f"Ethereum Median Transaction Fee (24h): ${median_fee}"]
    return [f"Unsupported chain: {chain}"]


@register_tool(
    name="get_chain_stats",
    description="Get blockchain network statistics and current fee estimates for Bitcoin or Ethereum.",
    schema={
        "type": "object",
        "properties": {
            "chain": {"type": "string", "enum": ["bitcoin", "ethereum"], "default": "bitcoin"},
        },
        "required": [],
    },
)
async def handle_get_chain_stats(exchange, chain: str = "bitcoin", **_) -> str:
    try:
        lines = _get_network_stats(chain)
        lines.append("")
        lines.extend(_get_fees(chain))
        return "\n".join(lines)
    except (URLError, OSError, json.JSONDecodeError) as e:
        return f"Error fetching chain data: {e}"
    except Exception as e:
        return f"Error in get_chain_stats: {e}"
