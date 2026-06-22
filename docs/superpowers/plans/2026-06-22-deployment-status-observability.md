# Deployment Status Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `deploy_strategy.status` show deployment-owned strategy instances and paper trading health so deployments are inspectable beyond a single deployment row.

**Architecture:** Keep status rendering inside the existing `deploy_strategy` tool. Source deployment topology from `strategy_deployments` plus `strategy_instances`, and source paper health from `paper_positions`, `paper_orders`, `pending_orders`, and `paper_fills`. Positions are attributable by deployment bot/account/symbol; orders, pending orders, and fills are attributable by strategy instance id.

**Tech Stack:** TypeScript ESM, existing tool registry, SQLite strategy deployment/instance rows, Vitest.

---

## Scope

- `deploy_strategy.status` lists each deployment.
- Under each deployment, it lists materialized instances with kind, symbol, enabled flag, allocated USDT, bot, and trading account.
- Under each paper deployment, it lists paper position count, open order count, pending order count, fill count, margin usage, realized PnL, and unrealized PnL.
- Under each paper deployment, it shows compact position, open order, pending order, and latest fill lines.
- Status and resident trader prompts include last strategy signal and last strategy error when runtime has observed them.
- Resident trader prompts include compact deployment health summaries for associated paper deployments.
- Existing activation/pause/stop behavior is unchanged.
- Live-mode observability remains a separate follow-up slice.

## Files

- Modify: `src/tools/deploy-strategy.ts`
- Modify: `src/strategy/deployment-health.ts`
- Modify: `src/strategy/runtime.ts`
- Modify: `src/agents/runtime.ts`
- Modify: `src/memory.ts`
- Test: `test/strategy-package-tools.test.ts`
- Test: `test/strategy-runtime-state.test.ts`
- Test: `test/resident-agent-runtime.test.ts`
- Test: `test/strategy-deployment-service.test.ts`

## Task 1: Instance Visibility

**Files:**
- Modify: `src/tools/deploy-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing test**

Extend the existing status test to assert:

```ts
expect(status).toContain("Instances:");
expect(status).toContain("btc_eth_signal:btc-usdt-usdt");
expect(status).toContain("allocated=150");
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "creates, validates, deploys"
```

Expected: fails because status currently lists only deployment rows.

- [x] **Step 3: Implement status expansion**

In `src/tools/deploy-strategy.ts`, when rendering each deployment, call:

```ts
memory.listStrategyInstances(dep.id)
```

and append one line per instance.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "creates, validates, deploys"
```

Expected: pass.

## Task 2: Initial Verification

**Files:**
- Verify only.

- [x] **Step 1: Focused tests**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts
```

Expected: pass.

## Task 3: Paper Health Summary

**Files:**
- Modify: `src/tools/deploy-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing test**

Add a deployment status test that seeds one deployment-owned paper position, open
order, pending order, and fill.

Expected status fragments:

```ts
Paper: positions=1 open_orders=1 pending_orders=1 fills=1 margin=250 unrealized_pnl=5 realized_pnl=6
Position: BTC/USDT:USDT long amount=0.01 entry=50000 mark=50500 margin=250 uPnL=5
OpenOrder: paper-open-1 buy limit BTC/USDT:USDT amount=0.01 price=49000
PendingOrder: paper-open-1 buy limit BTC/USDT:USDT amount=0.01 price=49000
Fill: paper-fill-1 sell BTC/USDT:USDT amount=0.01 price=50600 realized_pnl=6
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "deployment status includes paper trading health"
```

Observed: failed because status only listed deployment and instance rows.

- [x] **Step 3: Implement paper health rendering**

In `src/tools/deploy-strategy.ts`, add status rendering that:

- filters paper positions by deployment bot/account/symbol,
- filters open paper orders by strategy actor id matching deployment instances,
- filters fills by strategy actor id matching deployment instances,
- loads open pending orders by strategy instance id,
- renders aggregate counts, margin, unrealized PnL, realized PnL, and compact detail rows.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "deployment status includes paper trading health"
```

Observed: pass.

## Task 4: Runtime State and Resident Prompt Health

**Files:**
- Modify: `src/memory.ts`
- Modify: `src/strategy/runtime.ts`
- Modify: `src/strategy/deployment-health.ts`
- Modify: `src/tools/deploy-strategy.ts`
- Modify: `src/agents/runtime.ts`
- Test: `test/strategy-runtime-state.test.ts`
- Test: `test/strategy-package-tools.test.ts`
- Test: `test/resident-agent-runtime.test.ts`

- [x] **Step 1: Write failing runtime state tests**

Add tests that require runtime-emitted signals and executor errors to persist
against the owning strategy instance.

- [x] **Step 2: Write failing status and prompt tests**

Extend deployment status expectations for `LastSignal` and `LastError`, and
extend resident trader prompt expectations for compact deployment health.

- [x] **Step 3: Implement runtime state persistence**

Add `strategy_runtime_state` storage plus `recordStrategySignal`,
`recordStrategyError`, and `getStrategyRuntimeState`. Record signals from
`StrategyRuntime.startOne()` and executor errors from `wireExecutor()`.

- [x] **Step 4: Share deployment health rendering**

Move paper health collection/rendering into `src/strategy/deployment-health.ts`
and use it from both `deploy_strategy.status` and resident trader prompts.

- [x] **Step 5: Run GREEN**

Run:

```bash
npx vitest run test/strategy-runtime-state.test.ts
npx vitest run test/strategy-package-tools.test.ts -t "deployment status includes paper trading health"
npx vitest run test/resident-agent-runtime.test.ts -t "resident trader prompt includes active deployments"
```

Observed: pass.

## Task 5: Restart and Cancel Verification

**Files:**
- Test: `test/strategy-deployment-service.test.ts`
- Covered by existing test: `test/grid-e2e.test.ts`
- Covered by existing test: `test/executor-restore.test.ts`

- [x] **Step 1: Verify active deployment restart path**

Add and run a service-level restart test showing a fresh manager/runtime can
start active deployment instances from persisted deployment and instance rows.

Run:

```bash
npx vitest run test/strategy-deployment-service.test.ts
```

Observed: pass.

- [x] **Step 2: Keep existing cancel and paper state restore coverage**

Existing coverage:

- `test/grid-e2e.test.ts` verifies `StrategyRuntime.stopOne()` cascade-cancels
  open resting orders and marks pending orders cancelled.
- `test/strategy-deployment-service.test.ts` verifies deployment pause/stop call
  runtime `stopOne()` for owned instances.
- `test/executor-restore.test.ts` verifies persisted active positions restore
  conservatively across daemon restarts.

## Task 6: Final Verification

**Files:**
- Verify only.

- [x] **Step 1: Focused tests**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts
```

Expected: pass.

- [x] **Step 2: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [x] **Step 3: Full tests**

Run:

```bash
npm test
```

Expected: pass.

- [x] **Step 4: Diff check**

Run:

```bash
git diff --check
```

Expected: pass.
