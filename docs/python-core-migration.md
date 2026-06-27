# Python Core Migration Design

## Decision

This project is moving from a Node/TypeScript runtime to a Python runtime. This is a breaking rewrite, not a compatibility migration. The TypeScript daemon, tools, agent graphs, broker, exchange adapter, and SQLite access layer are treated as legacy once the Python core reaches functional parity.

The target runtime is:

```text
Python daemon
  -> Python LangGraph agent runtime
  -> Python tool layer
  -> Python trading engine
  -> SQLite persistence through Python repositories
  -> Docker deployment
```

The UI can be replaced independently. The trading engine must not live inside LangGraph. LangGraph is the orchestration layer for stateful agent flows, tool calls, checkpoints, deterministic verifiers, and scheduled resident-agent runs. Trading remains normal Python service code with explicit interfaces and tests.

## Non-Compatibility Rule

No old database compatibility is required. Deployment may reset SQLite and recreate initial identity rows. This lets the Python schema be designed around the real domain model instead of carrying TypeScript-era table drift.

## Target Module Layout

```text
crypto_agent/
  __init__.py
  main.py
  config.py
  db/
    __init__.py
    schema.py
    session.py
    repositories.py
  domain/
    __init__.py
    identity.py
    orders.py
    positions.py
    strategy.py
    risk.py
  market/
    __init__.py
    provider.py
    ccxt_provider.py
    candle_cache.py
    news.py
  trading/
    __init__.py
    broker.py
    paper_broker.py
    live_exchange.py
    risk_gate.py
    order_executor.py
    strategy_runtime.py
  backtest/
    __init__.py
    engine.py
    validators.py
    reports.py
  agents/
    __init__.py
    state.py
    context_builder.py
    main_graph.py
    researcher_graph.py
    trader_graph.py
    resident_runtime.py
    profiles.py
    prompts.py
  tools/
    __init__.py
    registry.py
    market_tools.py
    research_tools.py
    strategy_tools.py
    trading_tools.py
    resident_tools.py
  ipc/
    __init__.py
    server.py
    protocol.py
  cli/
    __init__.py
    main.py
```

## Domain Closure

The critical identity chain is:

```text
funding_account
  -> trading_account
    -> trading_bot
      -> bot_allocation
        -> resident_agent
          -> agent_run
            -> strategy_package / strategy_validation / strategy_deployment
            -> order / fill / position / trade / pnl
```

Any agent action that creates research, deploys strategy, or places an order must be traceable through this chain. This is the core invariant of the rewrite.

## Agent Graphs

### Main Graph

```text
user_message
  -> build_context
  -> llm
  -> tool_dispatch?
  -> verify_response
  -> persist_session
```

### Researcher Graph

```text
load_resident_profile
  -> build_research_context
  -> propose_or_review_hypothesis
  -> fetch_market_context / fetch_news_context / search_kb
  -> create_or_reject_strategy_package
  -> run_backtest_validation
  -> write_strategy_kb
  -> verify_durable_outcome
```

The final verifier is deterministic code. It must not rely on the LLM deciding to stop tool calls by itself.

### Trader Graph

```text
load_resident_profile
  -> build_trading_context
  -> inspect_portfolio
  -> inspect_strategy_deployments
  -> inspect_market_news_risk
  -> decide_trade_or_hold
  -> risk_gate
  -> order_executor
  -> persist_trade_event
  -> verify_action_audit
```

For paper trading, no human approval is required. For live trading, the policy may require a stricter gate, but the gate is still deterministic code.

## Trading Engine

The Python trading layer exposes a small broker protocol:

```text
fetch_balance()
fetch_positions()
create_order()
cancel_order()
mark_to_market()
```

Implementations:

- `PaperBroker`: authoritative simulated trading state, backed by SQLite, using real market prices but never private exchange keys.
- `LiveExchange`: Python `ccxt` adapter for OKX swaps, including leverage, margin mode, position side, and reduce-only behavior.
- `RiskGate`: deterministic pre-trade gate enforcing allocation, symbols, leverage, exposure, drawdown, daily loss, and news modifiers.
- `OrderExecutor`: serializes risk check plus order placement with an async lock.
- `StrategyRuntime`: deterministic strategy execution path, separate from LLM latency.

## Backtest And Validation

Backtest is a first-class validation layer, not a one-off tool call.

```text
StrategyPackage
  -> BacktestEngine
  -> ValidationReport
  -> DeploymentGate
  -> PaperDeployment
```

The first Python implementation only needs signal strategies. Grid and ladder strategies can be migrated after the signal package path closes end to end.

## Deployment

The final deployment target is a Python Docker container. During migration the repository may contain both Node and Python files, but production should run exactly one daemon. On `kr.cree1p.com`, deployment must explicitly check both Docker and user-systemd surfaces before concluding the old service is stopped.

## Completion Criteria

The migration is not complete until this run works from a clean database:

1. Start Python daemon.
2. Create BTC/ETH researcher resident.
3. Researcher loads profile, fetches context, creates or rejects a strategy, and stores durable evidence.
4. Strategy package passes validation before deployment.
5. Trader loads account, allocation, strategy, market, and risk context.
6. Trader passes RiskGate and places a paper order when action is allowed.
7. PaperBroker stores order, fill, position, trade, realized/unrealized PnL, and audit links.
8. Daemon restart restores resident agents, account state, positions, PnL, and watermarks.
9. Docker deployment reproduces the same flow remotely.

## Current Implementation Snapshot

As of 2026-06-27, the Python runtime has a local and remote paper-trading closure:

- `crypto-agent-py init-db --destructive` creates the destructive SQLite schema and default identity chain.
- `PaperBroker` persists paper orders, fills, positions, trades, and realized PnL.
- `RiskGate` enforces allocation notional, max leverage, max position percentage, drawdown halt, and persists denials.
- `OrderExecutor` blocks denied orders before broker execution.
- `StrategyValidationService` creates strategy packages, runs deterministic signal backtests, stores validation reports, and blocks deployment until a passed validation exists.
- Python tool registry exposes `get_portfolio`, `open_position`, `create_strategy_package`, `validate_strategy`, and `deploy_strategy`.
- Python LangGraph researcher/trader graphs run with real `StateGraph` in a dependency-installed venv.
- `ResidentRuntime` persists resident agents and audited runs, then dispatches researcher/trader graphs.
- `crypto-agent-py smoke` verifies clean-DB researcher-to-trader paper closure.
- `CryptoAgentIpcServer` exposes Unix-socket JSONL `health` and `smoke`.
- `LiveExchange` wraps ccxt/OKX swap market order parameters with leverage, margin mode, position side, and reduce-only handling.
- Production `Dockerfile` and `docker-compose.yml` run the Python daemon, not the Node daemon.
- On `kr.cree1p.com`, the Python Docker service was built, started, healthchecked through IPC, and smoke-tested against a clean SQLite database.
- Remote smoke evidence: researcher outcome `validated`, trader outcome `ordered`, strategy deployment created, open order filled, close order filled, long position quantity returned to `0.0`, and realized PnL was `1.0`.

Still open:

- Live private OKX preflight was not executed because both local and remote `.env` currently contain empty `EXCHANGE_API_KEY`, `EXCHANGE_SECRET`, and `EXCHANGE_PASSWORD` values.
- Real live orders remain intentionally unverified and should stay disabled until credentials are configured and a separate live-readiness preflight passes.
