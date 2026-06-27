from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from crypto_agent.domain.orders import OrderRequest


def get_portfolio(args: dict[str, Any], deps: dict[str, Any]) -> dict[str, Any]:
    db_path = Path(deps["db_path"])
    trading_account_id = args["trading_account_id"]
    bot_id = args["bot_id"]
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        allocation = conn.execute(
            """
            select id, currency, capital, max_leverage, max_position_pct
            from bot_allocations
            where trading_account_id = ? and bot_id = ?
            """,
            (trading_account_id, bot_id),
        ).fetchone()
        positions = conn.execute(
            """
            select symbol, position_side, quantity, entry_price, mark_price,
                   realized_pnl, unrealized_pnl
            from paper_positions
            where trading_account_id = ? and bot_id = ?
            order by symbol, position_side
            """,
            (trading_account_id, bot_id),
        ).fetchall()

    if allocation is None:
        raise ValueError(f"No allocation for bot {bot_id} on account {trading_account_id}")

    return {
        "trading_account_id": trading_account_id,
        "bot_id": bot_id,
        "allocation": dict(allocation),
        "positions": [dict(position) for position in positions],
    }


def open_position(args: dict[str, Any], deps: dict[str, Any]) -> Any:
    request = OrderRequest(
        trading_account_id=args["trading_account_id"],
        bot_id=args["bot_id"],
        symbol=args["symbol"],
        side=args["side"],
        position_side=args["position_side"],
        quantity=float(args["quantity"]),
        leverage=float(args.get("leverage", 1)),
        resident_agent_id=args.get("resident_agent_id"),
    )
    return deps["order_executor"].execute_market_order(
        request,
        mark_price=float(args["mark_price"]),
    )
