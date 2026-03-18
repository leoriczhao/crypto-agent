import json
from .registry import register_tool


@register_tool(
    name="execute_trade",
    description=(
        "Execute a trade or cancel an order.\n"
        "- buy/sell: place a market or limit order\n"
        "- cancel: cancel an open order\n"
        "IMPORTANT: All trades go through risk checks. Paper trading mode is ON by default."
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["buy", "sell", "cancel"]},
            "symbol": {"type": "string", "description": "Trading pair, e.g. BTC/USDT"},
            "amount": {"type": "number", "description": "Quantity of base currency to trade"},
            "order_type": {"type": "string", "enum": ["market", "limit"], "default": "market"},
            "price": {"type": "number", "description": "Limit price (required for limit orders)"},
            "order_id": {"type": "string", "description": "Order ID (for cancel action)"},
        },
        "required": ["action", "symbol"],
    },
)
async def handle_execute_trade(exchange, config, action: str, symbol: str,
                               amount: float = 0, order_type: str = "market",
                               price: float | None = None, order_id: str = "", **_) -> str:
    try:
        if action == "cancel":
            result = await exchange.cancel_order(order_id, symbol)
            return json.dumps(result, indent=2)

        if amount <= 0:
            return "Error: amount must be > 0"

        ticker = await exchange.fetch_ticker(symbol)
        cost = ticker["last"] * amount
        if cost > config.max_order_size_usdt:
            return f"Error: Order size ${cost:.2f} exceeds max ${config.max_order_size_usdt:.2f}. Reduce amount or adjust config."

        mode = "PAPER" if config.paper_trading else "LIVE"
        result = await exchange.create_order(symbol, action, order_type, amount, price)

        if "error" in result:
            return f"[{mode}] Trade failed: {result['error']}"

        return f"[{mode}] Order filled:\n{json.dumps(result, indent=2)}"
    except Exception as e:
        return f"Error executing trade: {e}"
