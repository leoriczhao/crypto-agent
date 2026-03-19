import json
from .registry import register_tool


@register_tool(
    name="get_klines",
    description="Get OHLCV candlestick data for technical analysis or backtesting.",
    schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Trading pair, e.g. BTC/USDT"},
            "timeframe": {"type": "string", "description": "Candle interval: 1m,5m,15m,1h,4h,1d", "default": "1h"},
            "limit": {"type": "integer", "description": "Number of candles", "default": 24},
        },
        "required": ["symbol"],
    },
)
async def handle_get_klines(exchange, symbol: str, timeframe: str = "1h", limit: int = 24, **_) -> str:
    try:
        data = await exchange.fetch_ohlcv(symbol, timeframe, limit)
        return json.dumps(data[-limit:], indent=2)
    except Exception as e:
        return f"Error: {e}"
