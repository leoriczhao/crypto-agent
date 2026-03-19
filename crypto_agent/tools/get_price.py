import json
from .registry import register_tool


@register_tool(
    name="get_price",
    description="Get current price, 24h change, and volume for a cryptocurrency.",
    schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Trading pair, e.g. BTC/USDT"},
        },
        "required": ["symbol"],
    },
)
async def handle_get_price(exchange, symbol: str, **_) -> str:
    try:
        data = await exchange.fetch_ticker(symbol)
        return json.dumps(data, indent=2)
    except Exception as e:
        return f"Error: {e}"
