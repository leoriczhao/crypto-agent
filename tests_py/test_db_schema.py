import sqlite3

from crypto_agent.db.schema import initialize_database


def table_count(db_path, table):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(f"select count(*) from {table}").fetchone()[0]


def table_names(db_path):
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "select name from sqlite_master where type = 'table' order by name"
        ).fetchall()
    return {row[0] for row in rows}


def test_initialize_database_creates_identity_chain(tmp_path):
    db_path = tmp_path / "crypto_agent.db"

    initialize_database(db_path, destructive=True)

    assert table_count(db_path, "funding_accounts") == 1
    assert table_count(db_path, "trading_accounts") == 1
    assert table_count(db_path, "trading_bots") == 1
    assert table_count(db_path, "bot_allocations") == 1


def test_initialize_database_creates_core_business_tables(tmp_path):
    db_path = tmp_path / "crypto_agent.db"

    initialize_database(db_path, destructive=True)

    assert {
        "resident_agents",
        "agent_runs",
        "strategy_packages",
        "strategy_validations",
        "strategy_deployments",
        "strategy_kb",
        "paper_orders",
        "paper_fills",
        "paper_positions",
        "trades",
        "daemon_state",
    }.issubset(table_names(db_path))


def test_destructive_initialize_removes_old_business_state(tmp_path):
    db_path = tmp_path / "crypto_agent.db"
    initialize_database(db_path, destructive=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "insert into strategy_kb(agent_id, symbol, timeframe, content) values (?, ?, ?, ?)",
            ("agent-1", "BTC/USDT:USDT", "1h", "old"),
        )

    initialize_database(db_path, destructive=True)

    assert table_count(db_path, "strategy_kb") == 0
    assert table_count(db_path, "funding_accounts") == 1
