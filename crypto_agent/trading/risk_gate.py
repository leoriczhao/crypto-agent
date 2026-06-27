from __future__ import annotations

import sqlite3
from pathlib import Path

from crypto_agent.domain.orders import OrderRequest
from crypto_agent.domain.risk import ALLOW, RiskDecision


class RiskGate:
    def __init__(self, db_path: str | Path, *, max_drawdown_pct: float = 0.20):
        self.db_path = Path(db_path)
        self.max_drawdown_pct = max_drawdown_pct

    def check_order(self, request: OrderRequest, *, mark_price: float) -> RiskDecision:
        if mark_price <= 0:
            raise ValueError("mark_price must be positive")

        with self._connect() as conn:
            allocation = self._fetch_allocation(conn, request)
            position_qty = self._fetch_position_quantity(conn, request)
            reducing = self._is_reducing_position(request, position_qty)

            decision = self._check_order(conn, request, mark_price, allocation, position_qty, reducing)
            if not decision.allowed:
                self._persist_denial(conn, request, mark_price, decision)
            return decision

    def _check_order(
        self,
        conn: sqlite3.Connection,
        request: OrderRequest,
        mark_price: float,
        allocation: sqlite3.Row,
        position_qty: float,
        reducing: bool,
    ) -> RiskDecision:
        leverage = float(request.leverage)
        max_leverage = float(allocation["max_leverage"])
        if leverage > max_leverage:
            return RiskDecision(
                allowed=False,
                rule="max_leverage",
                reason=f"Requested leverage {leverage:.1f} exceeds allocation max {max_leverage:.1f}",
            )

        if reducing:
            return ALLOW

        drawdown_decision = self._check_drawdown(conn, request.trading_account_id)
        if not drawdown_decision.allowed:
            return drawdown_decision

        capital = float(allocation["capital"])
        order_notional = request.quantity * mark_price
        max_notional = capital * leverage
        if order_notional > max_notional:
            return RiskDecision(
                allowed=False,
                rule="allocation_notional",
                reason=f"Order notional {order_notional:.2f} exceeds allocation buying power {max_notional:.2f}",
            )

        max_position_notional = capital * float(allocation["max_position_pct"])
        resulting_position_notional = (position_qty + request.quantity) * mark_price
        if resulting_position_notional > max_position_notional:
            return RiskDecision(
                allowed=False,
                rule="max_position_pct",
                reason=(
                    f"Resulting position notional {resulting_position_notional:.2f} "
                    f"exceeds max position notional {max_position_notional:.2f}"
                ),
            )

        return ALLOW

    def _check_drawdown(self, conn: sqlite3.Connection, trading_account_id: str) -> RiskDecision:
        row = conn.execute(
            """
            select peak_equity, current_equity
            from portfolio_watermarks
            where trading_account_id = ?
            """,
            (trading_account_id,),
        ).fetchone()
        if row is None:
            return ALLOW

        peak_equity = float(row["peak_equity"])
        current_equity = float(row["current_equity"])
        if peak_equity <= 0:
            return ALLOW

        drawdown_pct = (peak_equity - current_equity) / peak_equity
        if drawdown_pct > self.max_drawdown_pct:
            return RiskDecision(
                allowed=False,
                rule="drawdown_halt",
                reason=(
                    f"Portfolio drawdown {drawdown_pct * 100:.1f}% "
                    f"exceeds {self.max_drawdown_pct * 100:.1f}% limit"
                ),
            )
        return ALLOW

    def _fetch_allocation(self, conn: sqlite3.Connection, request: OrderRequest) -> sqlite3.Row:
        row = conn.execute(
            """
            select capital, max_leverage, max_position_pct
            from bot_allocations
            where bot_id = ? and trading_account_id = ?
            """,
            (request.bot_id, request.trading_account_id),
        ).fetchone()
        if row is None:
            raise ValueError(
                f"No allocation for bot {request.bot_id} on account {request.trading_account_id}"
            )
        return row

    def _fetch_position_quantity(self, conn: sqlite3.Connection, request: OrderRequest) -> float:
        row = conn.execute(
            """
            select quantity
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
        return float(row["quantity"]) if row else 0.0

    def _is_reducing_position(self, request: OrderRequest, position_qty: float) -> bool:
        if position_qty <= 0:
            return False
        return (
            request.position_side == "long"
            and request.side == "sell"
            or request.position_side == "short"
            and request.side == "buy"
        )

    def _persist_denial(
        self,
        conn: sqlite3.Connection,
        request: OrderRequest,
        mark_price: float,
        decision: RiskDecision,
    ) -> None:
        conn.execute(
            """
            insert into risk_denials (
              trading_account_id, bot_id, symbol, side, position_side,
              rule, reason, notional, leverage
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request.trading_account_id,
                request.bot_id,
                request.symbol,
                request.side,
                request.position_side,
                decision.rule,
                decision.reason,
                request.quantity * mark_price,
                request.leverage,
            ),
        )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma foreign_keys = on")
        return conn
