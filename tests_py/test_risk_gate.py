import sqlite3

from crypto_agent.db.schema import initialize_database
from crypto_agent.domain.orders import OrderRequest
from crypto_agent.domain.risk import RiskDecision
from crypto_agent.trading.order_executor import OrderExecutor
from crypto_agent.trading.risk_gate import RiskGate


class RecordingBroker:
    def __init__(self):
        self.requests = []

    def create_market_order(self, request, *, mark_price):
        self.requests.append((request, mark_price))
        return {"status": "filled"}


def denial_count(db_path):
    with sqlite3.connect(db_path) as conn:
        return conn.execute("select count(*) from risk_denials").fetchone()[0]


def test_risk_gate_rejects_leverage_above_allocation_limit_and_persists_denial(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    gate = RiskGate(db_path)

    decision = gate.check_order(
        OrderRequest(
            trading_account_id="trading-paper-default",
            bot_id="bot-default",
            symbol="BTC/USDT:USDT",
            side="buy",
            position_side="long",
            quantity=0.01,
            leverage=5,
        ),
        mark_price=50_000,
    )

    assert decision == RiskDecision(
        allowed=False,
        rule="max_leverage",
        reason="Requested leverage 5.0 exceeds allocation max 3.0",
    )
    assert denial_count(db_path) == 1


def test_order_executor_does_not_call_broker_when_risk_denies(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    broker = RecordingBroker()
    executor = OrderExecutor(risk_gate=RiskGate(db_path), broker=broker)

    result = executor.execute_market_order(
        OrderRequest(
            trading_account_id="trading-paper-default",
            bot_id="bot-default",
            symbol="BTC/USDT:USDT",
            side="buy",
            position_side="long",
            quantity=1.0,
            leverage=3,
        ),
        mark_price=50_000,
    )

    assert result.allowed is False
    assert result.rule == "allocation_notional"
    assert broker.requests == []
    assert denial_count(db_path) == 1


def test_risk_gate_rejects_position_exposure_above_max_position_pct(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    gate = RiskGate(db_path)

    decision = gate.check_order(
        OrderRequest(
            trading_account_id="trading-paper-default",
            bot_id="bot-default",
            symbol="ETH/USDT:USDT",
            side="buy",
            position_side="long",
            quantity=1.0,
            leverage=1,
        ),
        mark_price=1_000,
    )

    assert decision.allowed is False
    assert decision.rule == "max_position_pct"
    assert "exceeds max position notional" in decision.reason


def test_risk_gate_rejects_portfolio_drawdown_halt(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "insert into portfolio_watermarks (trading_account_id, peak_equity, current_equity) values (?, ?, ?)",
            ("trading-paper-default", 2000, 1500),
        )
    gate = RiskGate(db_path)

    decision = gate.check_order(
        OrderRequest(
            trading_account_id="trading-paper-default",
            bot_id="bot-default",
            symbol="BTC/USDT:USDT",
            side="buy",
            position_side="long",
            quantity=0.001,
            leverage=1,
        ),
        mark_price=50_000,
    )

    assert decision.allowed is False
    assert decision.rule == "drawdown_halt"
    assert "Portfolio drawdown 25.0% exceeds 20.0% limit" == decision.reason
