import json
from .registry import register_tool


@register_tool(
    name="market_data",
    description=(
        "Get cryptocurrency market data. Actions:\n"
        "- ticker: current price, 24h change, volume for a symbol\n"
        "- klines: OHLCV candlestick data\n"
        "- orderbook: current bids and asks\n"
        "Example symbols: BTC/USDT, ETH/USDT, SOL/USDT"
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["ticker", "klines", "orderbook"]},
            "symbol": {"type": "string", "description": "Trading pair, e.g. BTC/USDT"},
            "timeframe": {"type": "string", "description": "Kline interval: 1m,5m,15m,1h,4h,1d", "default": "1h"},
            "limit": {"type": "integer", "description": "Number of results", "default": 24},
            "exchange_id": {"type": "string", "description": "Specific exchange to query (optional, uses active exchange if not set)"},
        },
        "required": ["action", "symbol"],
    },
)
async def handle_market_data(exchange, action: str, symbol: str, timeframe: str = "1h", limit: int = 24, exchange_id: str = "", **_) -> str:
    try:
        if action == "ticker":
            data = await exchange.fetch_ticker(symbol)
            return json.dumps(data, indent=2)
        elif action == "klines":
            data = await exchange.fetch_ohlcv(symbol, timeframe, limit)
            return json.dumps(data[-limit:], indent=2)
        elif action == "orderbook":
            data = await exchange.fetch_order_book(symbol, limit)
            return json.dumps(data, indent=2)
        else:
            return f"Unknown action: {action}"
    except Exception as e:
        return f"Error fetching {action} for {symbol}: {e}"
