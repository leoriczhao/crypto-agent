import json
from .registry import register_tool


@register_tool(
    name="cancel_order",
    description="Cancel an open order by ID.",
    schema={
        "type": "object",
        "properties": {
            "order_id": {"type": "string", "description": "Order ID to cancel"},
            "symbol": {"type": "string", "description": "Trading pair the order belongs to"},
        },
        "required": ["order_id", "symbol"],
    },
)
async def handle_cancel_order(exchange, order_id: str, symbol: str, **_) -> str:
    try:
        result = await exchange.cancel_order(order_id, symbol)
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: {e}"
