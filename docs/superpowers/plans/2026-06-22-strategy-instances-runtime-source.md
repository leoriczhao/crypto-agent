# Strategy Instances Runtime Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deployment-owned `strategy_instances` the runtime source of truth for strategy package deployments.

**Architecture:** Keep manual/debug direct strategy tools working for now, but stop package deployment materialization from writing the legacy `strategies` table. Add a Memory loader that maps `strategy_instances` rows into runtime `StrategySnapshot`s, and make `StrategyManager` prefer those rows when bootstrapping.

**Tech Stack:** TypeScript ESM, SQLite via `better-sqlite3`, existing `StrategyManager`, existing `StrategyDeploymentService`, Vitest.

---

## Scope

- Deployment activation persists `strategy_deployments` and `strategy_instances`.
- Deployment activation no longer writes deployment instances into legacy `strategies`.
- `StrategyManager` can load runtime strategies from `strategy_instances`.
- If no `strategy_instances` exist, `StrategyManager` still falls back to legacy manual/debug `strategies` rows in this slice.
- Pause/resume/stop for deployment-owned instances updates `strategy_instances` and in-memory strategy state without writing legacy `strategies`.
- Legacy direct/manual strategy tools are not removed in this slice.

## Files

- Modify: `src/memory.ts`
- Modify: `src/strategy/manager.ts`
- Modify: `src/strategy/deployment-service.ts`
- Test: `test/strategy-deployment-service.test.ts`
- Test: `test/strategy-package-persistence.test.ts`

## Task 1: Load Runtime Strategies From Strategy Instances

**Files:**
- Modify: `src/memory.ts`
- Modify: `src/strategy/manager.ts`
- Test: `test/strategy-package-persistence.test.ts`

- [x] **Step 1: Write failing test**

Add a test named `strategy manager loads package deployment instances as runtime strategies`.
Create a strategy package, deployment, and strategy instance row directly. Then construct:

```ts
const manager = new StrategyManager(memory);
```

Assert:

```ts
expect(manager.getStrategy("dep-1:btc-signal")).toBeDefined();
expect(manager.getStrategy("dep-1:btc-signal")?.symbol).toBe("BTC/USDT:USDT");
expect(manager.getActiveStrategies()).toHaveLength(1);
```

Also add a fallback test named `strategy manager falls back to legacy strategies when no deployment instances exist`, which saves one manual strategy row and asserts a fresh manager still loads it.

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-persistence.test.ts -t "strategy manager loads package deployment instances"
```

Expected: fail because `StrategyManager` currently loads only legacy `strategies` rows.

- [x] **Step 3: Add Memory loader**

Add:

```ts
loadStrategyInstanceSnapshots(): StrategySnapshot[]
```

It maps `strategy_instances` rows into `StrategySnapshot` objects, preserving `id`, `kind`, `symbol`, `params`, `enabled`, `allocatedUsdt`, `botId`, `tradingAccountId`, `createdAt`, and `updatedAt`.

- [x] **Step 4: Update StrategyManager bootstrap**

In `StrategyManager.loadFromDb()`, prefer non-empty `loadStrategyInstanceSnapshots()` results. Use `loadAllStrategies()` only when no strategy instance loader exists or when it returns no rows.

- [x] **Step 5: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-persistence.test.ts -t "strategy manager loads package deployment instances"
```

Expected: pass.

## Task 2: Stop Deployment Path Legacy Strategy Writes

**Files:**
- Modify: `src/strategy/manager.ts`
- Modify: `src/strategy/deployment-service.ts`
- Test: `test/strategy-deployment-service.test.ts`

- [x] **Step 1: Write failing test**

Add a test named `deployment activation does not write legacy strategy rows`.
After `service.activate(...)`, assert:

```ts
expect(memory.loadAllStrategies()).toHaveLength(0);
expect(memory.listStrategyInstances("dep-1")).toHaveLength(2);
expect(manager.getStrategy("dep-1:btc-usdt-usdt")).toBeDefined();
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-deployment-service.test.ts -t "does not write legacy"
```

Expected: fail because `manager.addStrategy()` currently persists deployment instances to `strategies`.

- [x] **Step 3: Add non-persistent manager operations**

Update `StrategyManager.addStrategy()` and `StrategyManager.updateStrategy()` with an optional third argument or option:

```ts
{ persist?: boolean }
```

Default is `true`; when `persist === false`, update only in-memory state.

- [x] **Step 4: Use non-persistent materialization for deployments**

In `StrategyDeploymentService.materializeInstance()`, call:

```ts
this.manager.addStrategy({...}, { persist: false })
```

In deployment pause/resume state changes, call:

```ts
this.manager.updateStrategy(instance.id, { enabled }, { persist: false })
```

- [x] **Step 5: Run GREEN**

Run:

```bash
npx vitest run test/strategy-deployment-service.test.ts -t "does not write legacy"
```

Expected: pass.

## Task 3: Verification

**Files:**
- Verify only.

- [x] **Step 1: Focused tests**

Run:

```bash
npx vitest run test/strategy-package-persistence.test.ts test/strategy-deployment-service.test.ts
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
