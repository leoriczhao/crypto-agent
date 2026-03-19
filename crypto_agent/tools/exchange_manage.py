from .registry import register_tool


@register_tool(
    name="exchange_manage",
    description=(
        "Manage exchange connections.\n"
        "- list: show all connected exchanges and which is active\n"
        "- switch: change the active exchange\n"
        "- status: show connectivity status of all exchanges"
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list", "switch", "status"]},
            "exchange_id": {"type": "string", "description": "Exchange to switch to (for switch action)"},
        },
        "required": ["action"],
    },
)
async def handle_exchange_manage(exchange_manager, action: str, exchange_id: str = "", **_) -> str:
    try:
        if action == "list":
            exchanges = exchange_manager.list()
            active = exchange_manager.active_id
            lines = ["Connected Exchanges:", "=" * 35]
            for ex_id in exchanges:
                marker = " ← active" if ex_id == active else ""
                lines.append(f"  • {ex_id}{marker}")
            return "\n".join(lines)

        elif action == "switch":
            if not exchange_id:
                return "Error: exchange_id is required for switch action"
            exchange_manager.set_active(exchange_id)
            return f"Switched active exchange to: {exchange_id}"

        elif action == "status":
            exchanges = exchange_manager.list()
            lines = ["Exchange Status:", "=" * 45]
            for ex_id in exchanges:
                ex = exchange_manager.get(ex_id)
                try:
                    ticker = await ex.fetch_ticker("BTC/USDT")
                    lines.append(f"  ✅ {ex_id}: online (BTC=${ticker['last']:,.2f})")
                except Exception as e:
                    lines.append(f"  ❌ {ex_id}: error ({e})")
            return "\n".join(lines)

        return f"Unknown action: {action}"
    except KeyError as e:
        return f"Error: {e}"
    except Exception as e:
        return f"Error in exchange_manage: {e}"
