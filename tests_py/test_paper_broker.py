import sqlite3

from crypto_agent.db.schema import initialize_database
from crypto_agent.domain.orders import OrderRequest
from crypto_agent.trading.paper_broker import PaperBroker


def scalar(db_path, sql, params=()):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(sql, params).fetchone()[0]


def test_paper_broker_open_and_close_long_records_order_fill_position_and_pnl(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    broker = PaperBroker(db_path)

    opened = broker.create_market_order(
        OrderRequest(
            trading_account_id="trading-paper-default",
            bot_id="bot-default",
            symbol="BTC/USDT:USDT",
            side="buy",
            position_side="long",
            quantity=0.1,
        ),
        mark_price=50_000,
    )

    assert opened.status == "filled"
    assert opened.realized_pnl == 0
    position = broker.fetch_position("trading-paper-default", "bot-default", "BTC/USDT:USDT", "long")
    assert position is not None
    assert position.quantity == 0.1
    assert position.entry_price == 50_000
    assert scalar(db_path, "select count(*) from paper_orders") == 1
    assert scalar(db_path, "select count(*) from paper_fills") == 1

    closed = broker.create_market_order(
        OrderRequest(
            trading_account_id="trading-paper-default",
            bot_id="bot-default",
            symbol="BTC/USDT:USDT",
            side="sell",
            position_side="long",
            quantity=0.1,
        ),
        mark_price=51_000,
    )

    assert closed.status == "filled"
    assert closed.realized_pnl == 100
    position = broker.fetch_position("trading-paper-default", "bot-default", "BTC/USDT:USDT", "long")
    assert position is not None
    assert position.quantity == 0
    assert position.realized_pnl == 100
    assert scalar(db_path, "select count(*) from paper_orders") == 2
    assert scalar(db_path, "select count(*) from paper_fills") == 2
    assert scalar(db_path, "select count(*) from trades where realized_pnl = 100") == 1
