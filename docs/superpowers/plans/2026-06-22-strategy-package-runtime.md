# Strategy Package Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first working slice of the Strategy Package architecture: packages, validation records, paper deployments, compiled strategy instances, and a tool surface to activate/pause/stop deployments.

**Architecture:** Keep `CryptoDaemon`, `StrategyManager`, `StrategyRuntime`, `RiskGate`, `OrderExecutor`, `PaperBroker`, and `LiveExchange` as the execution backbone. Add a new strategy-package layer above existing runtime strategies: `StrategyPackage` stores research output, `StrategyPackageCompiler` converts executable specs into runtime strategy snapshots, and `StrategyDeploymentService` owns deployment lifecycle and runtime start/stop. Existing old SQLite compatibility remains intentionally unsupported; fresh DB deployment is expected.

**Tech Stack:** TypeScript ESM, SQLite via `better-sqlite3`, existing tool registry, existing strategy runtime, Vitest.

---

## Scope

This plan implements the first deployable slice:

- Strategy package persistence.
- Validation record persistence.
- Deployment and strategy instance persistence.
- Compiler for `signal` and `grid` executable specs.
- Deployment service that materializes package specs into runtime strategies.
- `strategy_package`, `validate_strategy`, and `deploy_strategy` tools.
- Daemon wiring so active deployments start on daemon boot.

This plan does not implement a full optimizer, live auto-promotion, complete
grid/ladder backtesting, or old database migrations.

## Files

- Create: `src/strategy/package-types.ts`
- Create: `src/strategy/package-compiler.ts`
- Create: `src/strategy/deployment-service.ts`
- Create: `src/tools/strategy-package.ts`
- Create: `src/tools/validate-strategy.ts`
- Create: `src/tools/deploy-strategy.ts`
- Modify: `src/memory.ts`
- Modify: `src/daemon.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/strategy/base.ts`
- Modify: `src/strategy/manager.ts`
- Test: `test/strategy-package-persistence.test.ts`
- Test: `test/strategy-package-compiler.test.ts`
- Test: `test/strategy-deployment-service.test.ts`
- Test: `test/strategy-package-tools.test.ts`

## Task 1: Persistence Model

**Files:**
- Modify: `src/memory.ts`
- Test: `test/strategy-package-persistence.test.ts`

- [x] **Step 1: Write failing tests**

Create tests for:

- creating and reading a strategy package,
- immutable `(id, version)` uniqueness,
- validation records,
- deployment records,
- strategy instance records,
- no `ALTER TABLE` migration path.

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-persistence.test.ts
```

Expected: fail because Memory has no strategy package methods.

- [x] **Step 3: Implement Memory schema and methods**

Add tables:

- `strategy_packages`
- `strategy_validations`
- `strategy_deployments`
- `strategy_instances`

Add typed row interfaces and CRUD methods. Keep old mandate methods present for
now, but new deployment flow must not depend on them.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-persistence.test.ts
```

Expected: pass.

## Task 2: Package Compiler

**Files:**
- Create: `src/strategy/package-types.ts`
- Create: `src/strategy/package-compiler.ts`
- Test: `test/strategy-package-compiler.test.ts`
- Modify: `src/strategy/base.ts`

- [x] **Step 1: Write failing tests**

Create tests for:

- a `signal` package with two symbols compiles into two runtime instances,
- a `grid` package compiles into one runtime instance,
- invalid kind is rejected,
- live deployment without `live_ready` package and passed validation is rejected,
- paper deployment permits `paper_ready` with waived validation.

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-compiler.test.ts
```

Expected: fail because compiler does not exist.

- [x] **Step 3: Implement compiler**

The compiler returns runtime instance inputs:

```ts
{
  id,
  deploymentId,
  packageId,
  packageVersion,
  kind,
  symbol,
  params,
  allocatedUsdt,
  botId,
  tradingAccountId
}
```

For `signal`, split one package into one instance per symbol. For `grid`, require
exactly one symbol.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-compiler.test.ts
```

Expected: pass.

## Task 3: Deployment Service

**Files:**
- Create: `src/strategy/deployment-service.ts`
- Modify: `src/strategy/manager.ts`
- Test: `test/strategy-deployment-service.test.ts`

- [x] **Step 1: Write failing tests**

Create tests for:

- activating a paper deployment creates deployment and strategy instance rows,
- activating starts strategies through a fake runtime,
- pausing disables runtime strategies and marks deployment paused,
- stopping disables runtime strategies and marks deployment stopped,
- invalid package validation blocks activation.

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-deployment-service.test.ts
```

Expected: fail because service does not exist.

- [x] **Step 3: Implement service**

The service should:

- create/propose deployments,
- activate deployments,
- compile packages to strategy instances,
- add instances to `StrategyManager`,
- start instances when runtime is available,
- pause/stop deployments by disabling instances and stopping runtime strategies.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-deployment-service.test.ts
```

Expected: pass.

## Task 4: Tool Surface

**Files:**
- Create: `src/tools/strategy-package.ts`
- Create: `src/tools/validate-strategy.ts`
- Create: `src/tools/deploy-strategy.ts`
- Modify: `src/tools/index.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing tests**

Create tests that use `dispatchTool()` for:

- `strategy_package.create`
- `validate_strategy.waive_for_paper`
- `deploy_strategy.activate`
- `deploy_strategy.status`

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts
```

Expected: fail because tools are not registered.

- [x] **Step 3: Implement tools**

Tools should use small action enums and return concise text summaries. They must
not print secrets or require live exchange credentials for paper deployments.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts
```

Expected: pass.

## Task 5: Daemon Wiring

**Files:**
- Modify: `src/daemon.ts`
- Test: existing daemon smoke checks.

- [x] **Step 1: Wire deployment service**

Daemon should create one `StrategyDeploymentService` after fast-path components
exist and pass it into tool dependencies.

- [x] **Step 2: Boot active deployments**

On daemon startup, active deployment instances should be loaded and started.

- [x] **Step 3: Run focused and full verification**

Run:

```bash
npx vitest run test/strategy-package-persistence.test.ts test/strategy-package-compiler.test.ts test/strategy-deployment-service.test.ts test/strategy-package-tools.test.ts
npm test
npm run build
git diff --check
```

Expected: all pass.
