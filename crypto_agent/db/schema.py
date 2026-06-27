from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable


TABLES: tuple[str, ...] = (
    "daemon_state",
    "risk_denials",
    "portfolio_watermarks",
    "trades",
    "paper_positions",
    "paper_fills",
    "paper_orders",
    "strategy_kb",
    "strategy_deployments",
    "strategy_validations",
    "strategy_packages",
    "agent_runs",
    "resident_agents",
    "bot_allocations",
    "trading_bots",
    "trading_accounts",
    "funding_accounts",
)


SCHEMA_SQL = """
create table if not exists funding_accounts (
  id text primary key,
  name text not null,
  base_currency text not null,
  initial_equity real not null,
  created_at text not null default (datetime('now'))
);

create table if not exists trading_accounts (
  id text primary key,
  funding_account_id text not null references funding_accounts(id),
  exchange text not null,
  mode text not null check (mode in ('paper', 'live')),
  base_currency text not null,
  created_at text not null default (datetime('now'))
);

create table if not exists trading_bots (
  id text primary key,
  trading_account_id text not null references trading_accounts(id),
  name text not null,
  status text not null check (status in ('active', 'paused', 'stopped')),
  created_at text not null default (datetime('now'))
);

create table if not exists bot_allocations (
  id text primary key,
  bot_id text not null references trading_bots(id),
  trading_account_id text not null references trading_accounts(id),
  currency text not null,
  capital real not null,
  max_leverage real not null,
  max_position_pct real not null,
  created_at text not null default (datetime('now'))
);

create table if not exists portfolio_watermarks (
  trading_account_id text primary key references trading_accounts(id),
  peak_equity real not null,
  current_equity real not null,
  updated_at text not null default (datetime('now'))
);

create table if not exists resident_agents (
  id text primary key,
  bot_id text not null references trading_bots(id),
  type text not null check (type in ('researcher', 'trader', 'risk_officer', 'operator')),
  name text not null,
  profile_path text not null,
  profile_hash text not null,
  status text not null check (status in ('active', 'paused', 'stopped')),
  interval_minutes integer,
  next_run_at text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists agent_runs (
  id text primary key,
  resident_agent_id text references resident_agents(id),
  bot_id text references trading_bots(id),
  run_type text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  started_at text not null default (datetime('now')),
  finished_at text,
  input text,
  output text,
  profile_path text,
  profile_hash text,
  error text
);

create table if not exists strategy_packages (
  id text primary key,
  bot_id text not null references trading_bots(id),
  resident_agent_id text references resident_agents(id),
  symbol text not null,
  timeframe text not null,
  name text not null,
  kind text not null,
  status text not null check (status in ('draft', 'validated', 'rejected', 'deployed', 'retired')),
  definition_json text not null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists strategy_validations (
  id text primary key,
  package_id text not null references strategy_packages(id),
  status text not null check (status in ('passed', 'failed')),
  report_json text not null,
  metrics_json text not null,
  created_at text not null default (datetime('now'))
);

create table if not exists strategy_deployments (
  id text primary key,
  package_id text not null references strategy_packages(id),
  bot_id text not null references trading_bots(id),
  trading_account_id text not null references trading_accounts(id),
  status text not null check (status in ('active', 'paused', 'stopped')),
  mode text not null check (mode in ('paper', 'live')),
  allocated_capital real not null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists strategy_kb (
  id integer primary key autoincrement,
  agent_id text not null,
  symbol text,
  timeframe text,
  content text not null,
  created_at text not null default (datetime('now'))
);

create table if not exists paper_orders (
  id text primary key,
  trading_account_id text not null references trading_accounts(id),
  bot_id text not null references trading_bots(id),
  resident_agent_id text references resident_agents(id),
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  position_side text not null check (position_side in ('long', 'short')),
  order_type text not null,
  quantity real not null,
  price real,
  status text not null check (status in ('open', 'filled', 'cancelled', 'rejected')),
  created_at text not null default (datetime('now'))
);

create table if not exists paper_fills (
  id text primary key,
  order_id text not null references paper_orders(id),
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  position_side text not null check (position_side in ('long', 'short')),
  quantity real not null,
  price real not null,
  fee real not null default 0,
  created_at text not null default (datetime('now'))
);

create table if not exists paper_positions (
  id text primary key,
  trading_account_id text not null references trading_accounts(id),
  bot_id text not null references trading_bots(id),
  symbol text not null,
  position_side text not null check (position_side in ('long', 'short')),
  quantity real not null,
  entry_price real not null,
  mark_price real not null,
  realized_pnl real not null default 0,
  unrealized_pnl real not null default 0,
  updated_at text not null default (datetime('now')),
  unique (trading_account_id, bot_id, symbol, position_side)
);

create table if not exists risk_denials (
  id integer primary key autoincrement,
  trading_account_id text not null references trading_accounts(id),
  bot_id text not null references trading_bots(id),
  symbol text not null,
  side text not null,
  position_side text not null,
  rule text not null,
  reason text not null,
  notional real not null,
  leverage real not null,
  created_at text not null default (datetime('now'))
);

create table if not exists trades (
  id text primary key,
  trading_account_id text not null references trading_accounts(id),
  bot_id text not null references trading_bots(id),
  order_id text references paper_orders(id),
  symbol text not null,
  side text not null,
  quantity real not null,
  entry_price real,
  exit_price real,
  realized_pnl real not null default 0,
  opened_at text,
  closed_at text
);

create table if not exists daemon_state (
  key text primary key,
  value text not null,
  updated_at text not null default (datetime('now'))
);
"""


DEFAULT_ROWS: tuple[tuple[str, tuple[object, ...]], ...] = (
    (
        "insert or ignore into funding_accounts (id, name, base_currency, initial_equity) values (?, ?, ?, ?)",
        ("funding-default", "Default Funding Account", "USDT", 2000.0),
    ),
    (
        "insert or ignore into trading_accounts (id, funding_account_id, exchange, mode, base_currency) values (?, ?, ?, ?, ?)",
        ("trading-paper-default", "funding-default", "okx", "paper", "USDT"),
    ),
    (
        "insert or ignore into trading_bots (id, trading_account_id, name, status) values (?, ?, ?, ?)",
        ("bot-default", "trading-paper-default", "Default Paper Bot", "active"),
    ),
    (
        "insert or ignore into bot_allocations (id, bot_id, trading_account_id, currency, capital, max_leverage, max_position_pct) values (?, ?, ?, ?, ?, ?, ?)",
        ("allocation-default", "bot-default", "trading-paper-default", "USDT", 2000.0, 3.0, 0.3),
    ),
)


def initialize_database(db_path: str | Path, *, destructive: bool = False) -> None:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(path) as conn:
        conn.execute("pragma foreign_keys = off")
        if destructive:
            _drop_tables(conn, TABLES)
        conn.executescript(SCHEMA_SQL)
        _insert_default_rows(conn, DEFAULT_ROWS)
        conn.execute("pragma foreign_keys = on")


def _drop_tables(conn: sqlite3.Connection, tables: Iterable[str]) -> None:
    for table in tables:
        conn.execute(f"drop table if exists {table}")


def _insert_default_rows(
    conn: sqlite3.Connection,
    rows: Iterable[tuple[str, tuple[object, ...]]],
) -> None:
    for sql, params in rows:
        conn.execute(sql, params)
