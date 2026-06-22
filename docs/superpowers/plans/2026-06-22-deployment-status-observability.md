# Deployment Status Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `deploy_strategy.status` show deployment-owned strategy instances so paper deployments are inspectable beyond a single deployment row.

**Architecture:** Keep status rendering inside the existing `deploy_strategy` tool and source data from `strategy_deployments` plus `strategy_instances`. This is the first P4 observability slice; richer order, fill, PnL, and last-signal aggregation remains a later step.

**Tech Stack:** TypeScript ESM, existing tool registry, SQLite strategy deployment/instance rows, Vitest.

---

## Scope

- `deploy_strategy.status` lists each deployment.
- Under each deployment, it lists materialized instances with kind, symbol, enabled flag, allocated USDT, bot, and trading account.
- Existing activation/pause/stop behavior is unchanged.
- No paper fill/PnL aggregation in this slice.

## Files

- Modify: `src/tools/deploy-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

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

## Task 2: Verification

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

