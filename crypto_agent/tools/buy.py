import json
from .registry import register_tool


@register_tool(
    name="buy",
    description="Buy cryptocurrency. Places a market or limit buy order. Checks against max order size.",
    schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Trading pair, e.g. BTC/USDT"},
            "amount": {"type": "number", "description": "Quantity of base currency to buy"},
            "order_type": {"type": "string", "enum": ["market", "limit"], "default": "market"},
            "price": {"type": "number", "description": "Limit price (required for limit orders)"},
        },
        "required": ["symbol", "amount"],
    },
)
async def handle_buy(exchange, config, symbol: str, amount: float, order_type: str = "market", price: float | None = None, **_) -> str:
    try:
        if amount <= 0:
            return "Error: amount must be > 0"
        ticker = await exchange.fetch_ticker(symbol)
        cost = ticker["last"] * amount
        if cost > config.max_order_size_usdt:
            return f"Error: Order size ${cost:.2f} exceeds max ${config.max_order_size_usdt:.2f}. Reduce amount or adjust config."
        mode = "PAPER" if config.paper_trading else "LIVE"
        result = await exchange.create_order(symbol, "buy", order_type, amount, price)
        if "error" in result:
            return f"[{mode}] Buy failed: {result['error']}"
        return f"[{mode}] Buy order filled:\n{json.dumps(result, indent=2)}"
    except Exception as e:
        return f"Error: {e}"
