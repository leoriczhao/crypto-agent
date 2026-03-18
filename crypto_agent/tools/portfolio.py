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
            if not hasattr(exchange, "fetch_positions"):
                return "Position tracking only available in paper trading mode."
            positions = await exchange.fetch_positions()
            if not positions:
                return "No open positions."
            lines = ["Symbol      | Amount       | Entry Price  | Current      | PnL"]
            lines.append("-" * 70)
            for sym, pos in positions.items():
                lines.append(
                    f"{sym:<11} | {pos['amount']:>12.6f} | {pos['avg_entry_price']:>12.2f} | "
                    f"{pos.get('current_price', 0):>12.2f} | {pos.get('unrealized_pnl', 0):>+10.2f}"
                )
            return "\n".join(lines)

        elif action == "orders":
            if hasattr(exchange, "_orders"):
                orders = exchange._orders[-20:]
                if not orders:
                    return "No order history."
                return json.dumps(orders, indent=2)
            return "Order history not available for live exchange."

        return f"Unknown action: {action}"
    except Exception as e:
        return f"Error: {e}"
