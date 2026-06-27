from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

from crypto_agent.domain.orders import ExecutedOrder, OrderRequest, Position


class PaperBroker:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)

    def create_market_order(self, request: OrderRequest, *, mark_price: float) -> ExecutedOrder:
        if mark_price <= 0:
            raise ValueError("mark_price must be positive")

        order_id = f"paper-order-{uuid.uuid4()}"
        fill_id = f"paper-fill-{uuid.uuid4()}"

        with self._connect() as conn:
            conn.execute("begin immediate")
            conn.execute(
                """
                insert into paper_orders (
                  id, trading_account_id, bot_id, resident_agent_id, symbol, side,
                  position_side, order_type, quantity, price, status
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    request.trading_account_id,
                    request.bot_id,
                    request.resident_agent_id,
                    request.symbol,
                    request.side,
                    request.position_side,
                    "market",
                    request.quantity,
                    mark_price,
                    "filled",
                ),
            )
            conn.execute(
                """
                insert into paper_fills (
                  id, order_id, symbol, side, position_side, quantity, price, fee
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    fill_id,
                    order_id,
                    request.symbol,
                    request.side,
                    request.position_side,
                    request.quantity,
                    mark_price,
                    0.0,
                ),
            )
            realized_pnl = self._apply_fill(conn, request, mark_price, order_id)

        return ExecutedOrder(order_id=order_id, fill_id=fill_id, status="filled", realized_pnl=realized_pnl)

    def fetch_position(
        self,
        trading_account_id: str,
        bot_id: str,
        symbol: str,
        position_side: str,
    ) -> Position | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                select id, trading_account_id, bot_id, symbol, position_side, quantity,
                       entry_price, mark_price, realized_pnl, unrealized_pnl
                from paper_positions
                where trading_account_id = ? and bot_id = ? and symbol = ? and position_side = ?
                """,
                (trading_account_id, bot_id, symbol, position_side),
            ).fetchone()
        if row is None:
            return None
        return Position(**dict(row))

    def _apply_fill(
        self,
        conn: sqlite3.Connection,
        request: OrderRequest,
        mark_price: float,
        order_id: str,
    ) -> float:
        current = conn.execute(
            """
            select id, quantity, entry_price, realized_pnl
            from paper_positions
            where trading_account_id = ? and bot_id = ? and symbol = ? and position_side = ?
            """,
            (
                request.trading_account_id,
                request.bot_id,
                request.symbol,
                request.position_side,
            ),
        ).fetchone()

        if request.position_side == "long":
            return self._apply_long_fill(conn, request, mark_price, order_id, current)

        return self._apply_short_fill(conn, request, mark_price, order_id, current)

    def _apply_long_fill(
        self,
        conn: sqlite3.Connection,
        request: OrderRequest,
        mark_price: float,
        order_id: str,
        current: sqlite3.Row | None,
    ) -> float:
        old_qty = float(current["quantity"]) if current else 0.0
        old_entry = float(current["entry_price"]) if current else 0.0
        old_realized = float(current["realized_pnl"]) if current else 0.0

        if request.side == "buy":
            new_qty = old_qty + request.quantity
            new_entry = ((old_qty * old_entry) + (request.quantity * mark_price)) / new_qty
            self._upsert_position(conn, request, current, new_qty, new_entry, mark_price, old_realized, 0.0)
            return 0.0

        if request.quantity > old_qty:
            raise ValueError("cannot close more long quantity than currently open")

        realized_delta = (mark_price - old_entry) * request.quantity
        new_qty = old_qty - request.quantity
        new_entry = old_entry if new_qty > 0 else 0.0
        new_realized = old_realized + realized_delta
        self._upsert_position(conn, request, current, new_qty, new_entry, mark_price, new_realized, 0.0)
        self._record_closed_trade(conn, request, order_id, old_entry, mark_price, realized_delta)
        return realized_delta

    def _apply_short_fill(
        self,
        conn: sqlite3.Connection,
        request: OrderRequest,
        mark_price: float,
        order_id: str,
        current: sqlite3.Row | None,
    ) -> float:
        old_qty = float(current["quantity"]) if current else 0.0
        old_entry = float(current["entry_price"]) if current else 0.0
        old_realized = float(current["realized_pnl"]) if current else 0.0

        if request.side == "sell":
            new_qty = old_qty + request.quantity
            new_entry = ((old_qty * old_entry) + (request.quantity * mark_price)) / new_qty
            self._upsert_position(conn, request, current, new_qty, new_entry, mark_price, old_realized, 0.0)
            return 0.0

        if request.quantity > old_qty:
            raise ValueError("cannot close more short quantity than currently open")

        realized_delta = (old_entry - mark_price) * request.quantity
        new_qty = old_qty - request.quantity
        new_entry = old_entry if new_qty > 0 else 0.0
        new_realized = old_realized + realized_delta
        self._upsert_position(conn, request, current, new_qty, new_entry, mark_price, new_realized, 0.0)
        self._record_closed_trade(conn, request, order_id, old_entry, mark_price, realized_delta)
        return realized_delta

    def _upsert_position(
        self,
        conn: sqlite3.Connection,
        request: OrderRequest,
        current: sqlite3.Row | None,
        quantity: float,
        entry_price: float,
        mark_price: float,
        realized_pnl: float,
        unrealized_pnl: float,
    ) -> None:
        if current:
            conn.execute(
                """
                update paper_positions
                set quantity = ?, entry_price = ?, mark_price = ?, realized_pnl = ?,
                    unrealized_pnl = ?, updated_at = datetime('now')
                where id = ?
                """,
                (
                    quantity,
                    entry_price,
                    mark_price,
                    realized_pnl,
                    unrealized_pnl,
                    current["id"],
                ),
            )
            return

        conn.execute(
            """
            insert into paper_positions (
              id, trading_account_id, bot_id, symbol, position_side, quantity,
              entry_price, mark_price, realized_pnl, unrealized_pnl
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"paper-position-{uuid.uuid4()}",
                request.trading_account_id,
                request.bot_id,
                request.symbol,
                request.position_side,
                quantity,
                entry_price,
                mark_price,
                realized_pnl,
                unrealized_pnl,
            ),
        )

    def _record_closed_trade(
        self,
        conn: sqlite3.Connection,
        request: OrderRequest,
        order_id: str,
        entry_price: float,
        exit_price: float,
        realized_pnl: float,
    ) -> None:
        conn.execute(
            """
            insert into trades (
              id, trading_account_id, bot_id, order_id, symbol, side, quantity,
              entry_price, exit_price, realized_pnl, opened_at, closed_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            """,
            (
                f"trade-{uuid.uuid4()}",
                request.trading_account_id,
                request.bot_id,
                order_id,
                request.symbol,
                request.side,
                request.quantity,
                entry_price,
                exit_price,
                realized_pnl,
            ),
        )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma foreign_keys = on")
        return conn
