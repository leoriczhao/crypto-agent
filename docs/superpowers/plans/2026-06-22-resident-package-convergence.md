# Resident Package Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Converge resident agents on the new strategy package and deployment model so long-running traders no longer require legacy strategy mandate assignments.

**Architecture:** Keep the existing daemon, IPC, resident scheduler, strategy runtime, paper broker, and deployment service. Change the governance layer above runtime execution: resident traders supervise strategy packages and deployments, researchers produce packages, and deployment lifecycle uses `StrategyDeploymentService`. Legacy mandates remain in storage for now but are no longer required for new resident trader creation or scheduled trader runs.

**Tech Stack:** TypeScript ESM, SQLite via `better-sqlite3`, existing tool registry, existing resident scheduler/runtime, existing strategy package compiler/deployment service, Vitest.

---

## Scope

This plan executes the immediate P0/P1 priority:

- Archive the implementation direction in a durable plan document.
- Fix the current first-slice deployment service gaps discovered during review.
- Change resident trader creation so `mandate_id` is not required.
- Change resident trader runtime prompts so assigned strategy packages and active deployments are first-class context.
- Keep old `strategy_mandate` APIs available for existing tests and historical rows, but remove them from the new resident trader happy path.
- Verify focused tests, full build, full test suite, and a fresh database daemon smoke.

This plan does not implement full backtest approval, live promotion, grid/ladder backtesting, or deployment to `kr.cree1p.com`.

## Files

- Modify: `src/agents/runtime.ts`
- Modify: `src/tools/resident-agent.ts`
- Modify: `src/tools/deploy-strategy.ts`
- Test: `test/resident-agent-runtime.test.ts`
- Test: `test/resident-agent-tool.test.ts`
- Test: `test/strategy-deployment-service.test.ts`
- Test: `test/strategy-package-tools.test.ts`

## Task 1: Fix Deployment Service Finish

**Files:**
- Modify: `src/tools/deploy-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing test for stop output**

Add an assertion that `deploy_strategy.stop` returns `stopped`, not `stopd`.

```ts
const stopped = await TOOL_HANDLERS.deploy_strategy({
  ...deps,
  action: "stop",
  deployment_id: "deploy-1",
});
expect(stopped).toContain("stopped");
expect(stopped).not.toContain("stopd");
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "stops a strategy deployment"
```

Expected: fails because current string interpolation produces `stopd`.

- [x] **Step 3: Implement minimal output fix**

In `src/tools/deploy-strategy.ts`, replace the suffix interpolation with an explicit map:

```ts
const pastTense = action === "pause" ? "paused" : action === "resume" ? "resumed" : "stopped";
return `Strategy deployment ${deploymentId} ${pastTense}.`;
```

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "stops a strategy deployment"
```

Expected: pass.

## Task 2: Resident Agent Spawn Without Legacy Mandate

**Files:**
- Modify: `src/tools/resident-agent.ts`
- Test: `test/resident-agent-tool.test.ts`

- [x] **Step 1: Write failing test**

Add a test that spawns a trader with capital, schedule, risk policy, and no `mandate_id`.

```ts
const result = await TOOL_HANDLERS.resident_agent({
  memory,
  sessionId: "s-main",
  action: "spawn",
  type: "trader",
  name: "Package Trader",
  capital_usdt: 300,
  interval_minutes: 30,
  symbols: ["BTC/USDT", "ETH/USDT"],
  instructions: "Supervise validated strategy package deployments.",
});
expect(result).toContain("Resident agent created");
expect(result).toContain("packages=all_allowed");
const agent = memory.listResidentAgents({ type: "trader" })[0];
expect(agent.capitalAllocationId).toBeTruthy();
expect(memory.listAgentMandateAssignments(agent.id, { activeOnly: true })).toHaveLength(0);
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/resident-agent-tool.test.ts -t "spawns a resident trader without a legacy mandate"
```

Expected: fails because current tool requires an active `mandate_id`.

- [x] **Step 3: Update resident tool**

Change tool description and schema copy from "mandate required" to "package/deployment governance". Keep `mandate_id` accepted as optional legacy metadata. Remove the hard error when a trader has no active legacy mandate. For status output, show active deployments for the agent when present and keep legacy mandate IDs only as a trailing compatibility column.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/resident-agent-tool.test.ts
```

Expected: pass.

## Task 3: Resident Runtime Uses Packages And Deployments

**Files:**
- Modify: `src/agents/runtime.ts`
- Test: `test/resident-agent-runtime.test.ts`

- [x] **Step 1: Write failing runtime tests**

Add two tests:

```ts
test("runs an active resident trader without legacy mandates", async () => {
  const resident = memory.createResidentAgent({
    id: "resident-package-trader",
    type: "trader",
    name: "Package Trader",
    botId: "bot-1",
    tradingAccountId: "ta-1",
    capitalAllocationId: "alloc-1",
    scheduleExpr: "every_30m",
    nextRun: null,
    mandate: "Supervise strategy package deployments.",
    toolPolicy: "trader.v2",
    riskPolicy: { maxLeverage: 3 },
  });
  const runtime = new ResidentAgentRuntime({ memory, agent });
  await runtime.runAgent(resident.id, "manual");
  expect(agent.chatInSession).toHaveBeenCalledWith(
    resident.sessionId,
    expect.stringContaining("Strategy Package Context"),
  );
});
```

```ts
test("resident trader prompt includes active deployments", async () => {
  memory.createStrategyPackage({
    id: "btc_signal",
    version: 1,
    familyId: "btc_signal",
    name: "BTC Signal",
    status: "paper_ready",
    source: "researcher",
    mandate: "Trade BTC only when condition evidence is valid.",
    executableSpec: {
      kind: "signal",
      symbols: ["BTC/USDT"],
      timeframe: "1h",
      side: "long",
      entry: [{ indicator: "rsi", operator: "lt", value: 35 }],
      exit: [{ indicator: "rsi", operator: "gt", value: 55 }],
      positionSizeUsdt: 50,
      stopLossPct: 3,
      takeProfitPct: 5,
    },
    riskPolicy: { maxLeverage: 3, maxSingleNotionalUsdt: 50, maxTotalNotionalUsdt: 300 },
    validationStatus: "waived",
  });
  memory.createStrategyDeployment({
    id: "deploy-btc",
    packageId: "btc_signal",
    packageVersion: 1,
    status: "active",
    mode: "PAPER",
    tradingAccountId: "ta-1",
    botId: "bot-1",
    capitalAllocationId: "alloc-1",
    residentTraderId: "resident-package-trader",
    runtimePolicy: {},
  });
  await runtime.runAgent("resident-package-trader", "manual");
  const prompt = vi.mocked(agent.chatInSession).mock.calls[0][1];
  expect(prompt).toContain("deploy-btc");
  expect(prompt).toContain("btc_signal@1");
});
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/resident-agent-runtime.test.ts
```

Expected: fails because current runtime throws when no legacy mandate exists and prompt only formats mandates.

- [x] **Step 3: Implement runtime context**

Add package/deployment prompt helpers:

- `formatStrategyPackages(memory)` lists packages with status and validation.
- `formatDeployments(memory, agent)` lists deployments for the resident trader or its bot.
- `buildRunPrompt` includes `## Strategy Package Context` and `## Active Deployments`.
- Trader role contract says supervise deployments, activate only validated packages, and pause/stop when risk requires it.
- Remove the hard throw for traders without legacy mandate assignments.
- Keep legacy mandates formatted under `## Legacy Strategy Mandates` when they exist.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/resident-agent-runtime.test.ts
```

Expected: pass.

## Task 4: Focused Regression Suite

**Files:**
- Test: `test/resident-agent-runtime.test.ts`
- Test: `test/resident-agent-tool.test.ts`
- Test: `test/strategy-package-tools.test.ts`
- Test: `test/strategy-deployment-service.test.ts`

- [x] **Step 1: Run focused tests**

Run:

```bash
npx vitest run test/resident-agent-runtime.test.ts test/resident-agent-tool.test.ts test/strategy-package-tools.test.ts test/strategy-deployment-service.test.ts
```

Expected: all listed tests pass.

- [x] **Step 2: Fix only scoped regressions**

If a failure appears, fix the direct cause in the files listed above and rerun the same command. Do not refactor unrelated runtime or exchange behavior.

## Task 5: Full Verification

**Files:**
- Verify only.

- [x] **Step 1: Build**

Run:

```bash
npm run build
```

Expected: TypeScript exits 0.

- [x] **Step 2: Full tests**

Run:

```bash
npm test
```

Expected: Vitest exits 0.

- [x] **Step 3: Diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [x] **Step 4: Fresh DB smoke**

Run:

```bash
rm -rf /tmp/crypto-agent-package-smoke
mkdir -p /tmp/crypto-agent-package-smoke
env MEMORY_DB_PATH=/tmp/crypto-agent-package-smoke/smoke.db \
  CRYPTO_AGENT_RUNTIME_DIR=/tmp/crypto-agent-package-smoke \
  PAPER_TRADING=true \
  INITIAL_BALANCE_USDT=2000 \
  DEFAULT_EXCHANGE=okx \
  HEARTBEAT_INTERVAL=86400 \
  timeout 6s npm run daemon
code=$?
rm -rf /tmp/crypto-agent-package-smoke
test "$code" -eq 124
```

Expected: daemon starts, logs readiness, then timeout exits 124.

