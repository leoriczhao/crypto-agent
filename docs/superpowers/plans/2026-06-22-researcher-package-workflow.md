# Researcher Package Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make resident researchers produce auditable strategy package drafts or immutable package revisions, with KB-first research and no deployment/capital authority.

**Architecture:** Keep execution and allocation under resident traders and deployment tools. Extend the strategy package tool with an explicit `revise` action that creates a new immutable version from an existing package, then tighten resident researcher prompts so research runs search KB first, log every outcome, and never activate deployments.

**Tech Stack:** TypeScript ESM, SQLite via `better-sqlite3`, existing tool registry, resident runtime prompts, Vitest.

---

## Scope

- `strategy_package.revise` creates a new immutable package version from an existing package.
- Revisions default to `draft` and `not_run` validation.
- Revision overrides can replace mandate, executable spec, risk policy, name, and source.
- Existing package versions remain unchanged.
- Resident researcher prompt requires `kb_search` before new work.
- Resident researcher prompt requires `kb_log` for adopted, rejected, and pending outcomes.
- Resident researcher prompt says adopted work becomes `strategy_package.create` or `strategy_package.revise`.
- Resident researcher prompt forbids capital allocation and deployment activation.

## Files

- Modify: `src/memory.ts`
- Modify: `src/tools/strategy-package.ts`
- Modify: `src/agents/runtime.ts`
- Test: `test/strategy-package-tools.test.ts`
- Test: `test/resident-agent-runtime.test.ts`

## Task 1: Strategy Package Revision Tool

**Files:**
- Modify: `src/memory.ts`
- Modify: `src/tools/strategy-package.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing test**

Add a test named `revises a strategy package into the next immutable version`.
It should create `btc_signal@1`, call:

```ts
await TOOL_HANDLERS.strategy_package({
  memory,
  action: "revise",
  id: "btc_signal",
  version: 1,
  name: "BTC Signal v2",
  source: "resident-researcher",
  mandate: { thesis: "Use stricter RSI pullbacks." },
  executable_spec: {
    kind: "signal",
    symbols: ["BTC/USDT:USDT"],
    timeframe: "1h",
    side: "long",
    entry: [{ indicator: "rsi", operator: "lt", value: 30 }],
    exit: [{ indicator: "rsi", operator: "gt", value: 60 }],
    positionSizeUsdt: 40,
    stopLossPct: 2,
    takeProfitPct: 4,
  },
  risk_policy: { maxLeverage: 2, maxSingleNotionalUsdt: 40, maxTotalNotionalUsdt: 120 },
});
```

Assert the output contains `btc_signal@2`, `memory.getStrategyPackage("btc_signal", 1)` is unchanged, and `memory.getStrategyPackage("btc_signal", 2)` has `status=draft`, `validationStatus=not_run`, updated fields, and the same `familyId`.

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "revises a strategy package"
```

Expected: fail because `strategy_package` does not support `revise`.

- [x] **Step 3: Add memory helper**

Add:

```ts
nextStrategyPackageVersion(familyId: string): number
```

It reads packages by `family_id`, returns max version + 1, and returns `1` when none exist.

- [x] **Step 4: Implement `strategy_package.revise`**

In `src/tools/strategy-package.ts`, add `revise` to the action enum. Load the base package by `id@version`, compute the next version from `base.familyId`, and create a new package with:

```ts
status: "draft",
validationStatus: "not_run",
validationSummary: null,
familyId: base.familyId,
mandate: mandate === undefined ? base.mandate : obj(mandate),
executableSpec: executable_spec === undefined ? base.executableSpec : obj(executable_spec),
riskPolicy: risk_policy === undefined ? base.riskPolicy : obj(risk_policy),
```

- [x] **Step 5: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "revises a strategy package"
```

Expected: pass.

## Task 2: Resident Researcher Prompt Protocol

**Files:**
- Modify: `src/agents/runtime.ts`
- Test: `test/resident-agent-runtime.test.ts`

- [x] **Step 1: Write failing test**

Add a test named `resident researcher prompt enforces KB-first package workflow`.
Create a resident agent with `type: "researcher"`, run it, and assert the prompt contains:

```text
Search strategy KB with kb_search before proposing new work.
Log every outcome with kb_log.
Adopted hypotheses become strategy_package.create or strategy_package.revise.
Do not allocate capital.
Do not call deploy_strategy.
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/resident-agent-runtime.test.ts -t "resident researcher prompt enforces"
```

Expected: fail because the current researcher prompt does not contain these boundaries.

- [x] **Step 3: Implement prompt protocol**

Update the researcher role contract and run instructions in `src/agents/runtime.ts` to include KB-first research, KB logging, package create/revise, and no allocation/deployment authority.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/resident-agent-runtime.test.ts -t "resident researcher prompt enforces"
```

Expected: pass.

## Task 3: Verification

**Files:**
- Verify only.

- [x] **Step 1: Focused tests**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts test/resident-agent-runtime.test.ts
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
