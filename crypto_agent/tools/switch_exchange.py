from .registry import register_tool


@register_tool(
    name="switch_exchange",
    description="Switch the active exchange. Shows all connected exchanges if no exchange_id given.",
    schema={
        "type": "object",
        "properties": {
            "exchange_id": {"type": "string", "description": "Exchange to switch to, e.g. okx, gateio, binance"},
        },
        "required": [],
    },
)
async def handle_switch_exchange(exchange_manager, exchange_id: str = "", **_) -> str:
    try:
        exchanges = exchange_manager.list()
        active = exchange_manager.active_id

        if not exchange_id:
            lines = ["Connected Exchanges:", "=" * 35]
            for ex_id in exchanges:
                marker = " ← active" if ex_id == active else ""
                lines.append(f"  • {ex_id}{marker}")

            lines.extend(["", "Exchange Status:", "=" * 45])
            for ex_id in exchanges:
                ex = exchange_manager.get(ex_id)
                try:
                    ticker = await ex.fetch_ticker("BTC/USDT")
                    lines.append(f"  ✅ {ex_id}: online (BTC=${ticker['last']:,.2f})")
                except Exception as e:
                    lines.append(f"  ❌ {ex_id}: error ({e})")
            return "\n".join(lines)

        exchange_manager.set_active(exchange_id)
        return f"Switched active exchange to: {exchange_id}"
    except KeyError as e:
        return f"Error: {e}"
    except Exception as e:
        return f"Error in switch_exchange: {e}"
