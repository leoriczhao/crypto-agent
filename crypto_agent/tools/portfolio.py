import json
from .registry import register_tool


@register_tool(
    name="portfolio",
    description=(
        "View portfolio information.\n"
        "- balance: show all asset balances\n"
        "- positions: show open positions with PnL\n"
        "- orders: show recent order history"
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["balance", "positions", "orders"]},
        },
        "required": ["action"],
    },
)
async def handle_portfolio(exchange, action: str, **_) -> str:
    try:
        if action == "balance":
            balance = await exchange.fetch_balance()
            if not balance:
                return "No assets in portfolio."
            lines = ["Asset     | Free         | Total"]
            lines.append("-" * 40)
            for asset, info in sorted(balance.items()):
                lines.append(f"{asset:<9} | {info['free']:>12.4f} | {info['total']:>12.4f}")
            return "\n".join(lines)

        elif action == "positions":
            positions = await exchange.fetch_positions()
            if not positions:
                return "No open positions."
            lines = ["Symbol           | Side   | Size         | Entry        | Mark         | PnL"]
            lines.append("-" * 85)
            for sym, pos in positions.items():
                side = pos.get("side", "long").upper()
                size = pos.get("contracts", pos.get("amount", 0))
                entry = pos.get("avg_entry_price", 0)
                mark = pos.get("current_price", 0)
                pnl = pos.get("unrealized_pnl", 0)
                leverage = pos.get("leverage")
                lev_str = f" {leverage}x" if leverage else ""
                lines.append(
                    f"{sym:<16} | {side:<6} | {size:>12.4f} | {entry:>12.2f} | "
                    f"{mark:>12.2f} | {pnl:>+10.2f}{lev_str}"
                )
            return "\n".join(lines)

        elif action == "orders":
            if hasattr(exchange, "_orders"):
                orders = exchange._orders[-20:]
                if not orders:
                    return "No order history."
                return json.dumps(orders, indent=2)
            open_orders = await exchange.fetch_open_orders()
            if not open_orders:
                return "No open orders."
            return json.dumps(open_orders, indent=2)

        return f"Unknown action: {action}"
    except Exception as e:
        return f"Error: {e}"
