# Live Readiness Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a no-order live deployment preflight and block live activation unless explicit approval is present.

**Architecture:** Keep paper execution and live exchange execution separate. Add a `deploy_strategy.check` action that compiles and validates a package for `PAPER` or `LIVE` without creating deployments or placing orders, then add a narrow LIVE activation guard requiring `runtime_policy.live_approved === true`.

**Tech Stack:** TypeScript ESM, existing tool registry, existing strategy package compiler/deployment service, Vitest.

---

## Scope

- `deploy_strategy.check` reports whether a package can be deployed in the requested mode.
- `check` never calls `StrategyDeploymentService.activate`.
- LIVE check requires `live_ready` package status and `passed` validation through the existing deployability gate.
- LIVE check reports intended symbols, margin mode, position mode, configured max leverage, and approval status.
- LIVE activation is blocked unless `runtime_policy.live_approved === true`.
- No live order is placed in this slice.
- Exchange-market metadata and min-notional checks remain follow-up work unless local exchange adapters expose a stable method.

## Files

- Modify: `src/tools/deploy-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

## Task 1: Add `deploy_strategy.check`

**Files:**
- Modify: `src/tools/deploy-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing test**

Add a test named `checks live strategy deployment without activating it`.
Create a package with `status: "live_ready"` and `validationStatus: "passed"`,
then call:

```ts
await TOOL_HANDLERS.deploy_strategy({
  memory,
  strategy_deployment_service: service,
  action: "check",
  package_id: "btc_live_signal",
  package_version: 1,
  mode: "LIVE",
  capital_usdt: 300,
  runtime_policy: { live_approved: true },
  config: {
    contractMarginMode: "isolated",
    contractPositionMode: "hedge",
    contractMaxLeverage: 5,
  },
});
```

Assert output contains:

```text
Strategy deployment check: ok
mode=LIVE
package=btc_live_signal@1
instances=btc_live_signal
margin_mode=isolated
position_mode=hedge
live_approved=true
```

Assert `memory.listStrategyDeployments()` and `memory.listStrategyInstances()`
remain empty.

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "checks live strategy deployment"
```

Expected: fail because `deploy_strategy.check` is not implemented.

- [x] **Step 3: Implement check action**

In `src/tools/deploy-strategy.ts`, add action enum value `check`. For `check`,
load the package, call `assertPackageDeployable(pkg, mode)`, call
`compileStrategyPackage(...)`, and return a text report. Do not call
`strategy_deployment_service.activate()`.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "checks live strategy deployment"
```

Expected: pass.

## Task 2: Block LIVE Activation Without Approval

**Files:**
- Modify: `src/tools/deploy-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing test**

Add a test named `blocks live activation without explicit approval`. Create a
`live_ready`/`passed` package and call `deploy_strategy.activate` with
`mode: "LIVE"` and no `runtime_policy.live_approved`.

Assert:

```ts
expect(result).toContain("live_approved");
expect(memory.listStrategyDeployments()).toHaveLength(0);
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "blocks live activation"
```

Expected: fail because live activation currently proceeds once package status
and validation pass.

- [x] **Step 3: Implement activation guard**

In `src/tools/deploy-strategy.ts`, before `strategy_deployment_service.activate`,
if `modeValue(mode) === "LIVE"` and `runtime_policy.live_approved !== true`,
return an error explaining that explicit approval is required.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "blocks live activation"
```

Expected: pass.

## Task 3: Verification

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
