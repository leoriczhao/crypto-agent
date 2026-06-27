# Persistence Design

This document describes the current Python SQLite schema. The old TypeScript
SQLite layer was removed. No old database compatibility is required.

## Principle

Persist state when losing it would cause:

1. Financial loss.
2. Missing audit evidence.
3. Risk controls being bypassed.
4. Resident-agent or strategy runs becoming impossible to trace.

Market data can be cached later for research quality, but it is not the source
of truth for account state. The current Python core keeps persistence focused on
identity, strategies, paper execution, risk denials, and run audit.

## Schema Owner

The schema lives in `crypto_agent/db/schema.py`. `crypto-agent-py init-db
--destructive` drops and recreates all current tables.

## Tables

| Table | Purpose |
| --- | --- |
| `funding_accounts` | Capital owner or funding pool identity. |
| `trading_accounts` | Exchange and mode scope, linked to a funding account. |
| `trading_bots` | Bot identity bound to one trading account. |
| `bot_allocations` | Paper wallet capital, leverage cap, and position cap. |
| `portfolio_watermarks` | Peak and current equity for drawdown enforcement. |
| `resident_agents` | Long-lived researcher/trader/operator identities. |
| `agent_runs` | Audited execution record for each resident wake. |
| `strategy_packages` | Structured signal strategy package definitions. |
| `strategy_validations` | Backtest validation reports and metrics. |
| `strategy_deployments` | Deployment records for validated packages. |
| `strategy_kb` | Durable researcher notes and outcomes. |
| `paper_orders` | Local paper order history. |
| `paper_fills` | Local paper fill audit log. |
| `paper_positions` | Local paper position state and PnL. |
| `risk_denials` | Deterministic RiskGate rejection records. |
| `trades` | Closed or trade-level realized PnL audit. |
| `daemon_state` | Small key/value runtime state. |

## Identity Chain

All trading-bearing records must connect back to this chain:

```text
funding_account
  -> trading_account
    -> trading_bot
      -> bot_allocation
        -> resident_agent
          -> agent_run
            -> strategy_package / strategy_validation / strategy_deployment
            -> paper_order / paper_fill / paper_position / trade / risk_denial
```

The default seed rows are:

- `funding-default`
- `trading-paper-default`
- `bot-default`
- `allocation-default`

The default allocation is 2,000 USDT, max leverage 3x, max position 30 percent.

## Paper Execution

`PaperBroker` is the accounting authority in paper mode. It stores orders,
fills, positions, realized PnL, and mark-to-market fields in SQLite. Paper mode
must not use private exchange credentials.

## Risk Gate

`RiskGate` runs before `OrderExecutor` sends an order to the broker. It enforces:

- Allocation existence.
- Notional size relative to bot capital.
- Leverage cap.
- Position-size cap.
- Portfolio drawdown halt.

Rejected orders are persisted in `risk_denials`.

## Strategy Validation

`StrategyValidationService` creates strategy packages, validates them through
the Python backtest layer, stores reports, and only deploys packages with a
passed validation. The first implementation covers signal strategies.

## Restart Behavior

The Python daemon initializes the schema on startup when launched with
`--init-db`. Existing data is preserved unless `--destructive` is explicitly
passed. Resident agents, packages, validations, deployments, paper positions,
fills, trades, and risk denials are stored in SQLite and survive normal daemon
restarts.
