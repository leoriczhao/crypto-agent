import json
from .registry import register_tool


@register_tool(
    name="get_portfolio",
    description="Get complete portfolio overview: asset balances, open positions with PnL, and open orders.",
    schema={"type": "object", "properties": {}},
)
async def handle_get_portfolio(exchange, **_) -> str:
    try:
        lines = []

        balance = await exchange.fetch_balance()
        if balance:
            lines.append("Asset     | Free         | Total")
            lines.append("-" * 40)
            for asset, info in sorted(balance.items()):
                lines.append(f"{asset:<9} | {info['free']:>12.4f} | {info['total']:>12.4f}")
        else:
            lines.append("No assets.")

        lines.append("")

        positions = await exchange.fetch_positions()
        if positions:
            lines.append("Symbol           | Side   | Size         | Entry        | Mark         | PnL")
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
        else:
            lines.append("No open positions.")

        lines.append("")

        if hasattr(exchange, "_orders"):
            orders = exchange._orders[-20:]
            if orders:
                lines.append("Recent Orders:")
                lines.append(json.dumps(orders, indent=2))
        else:
            open_orders = await exchange.fetch_open_orders()
            if open_orders:
                lines.append("Open Orders:")
                lines.append(json.dumps(open_orders, indent=2))

        return "\n".join(lines)
    except Exception as e:
        return f"Error: {e}"
