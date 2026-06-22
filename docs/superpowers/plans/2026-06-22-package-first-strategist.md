# Package-First Strategist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove direct runtime strategy creation from strategist/research workflows so autonomous research produces strategy packages and validation records instead of bypassing deployment governance.

**Architecture:** Keep existing direct `plan_strategy`, `plan_grid_strategy`, and `plan_ladder_strategy` tools registered for manual/debug use. Change autonomous strategist workflows to use `strategy_package`, `validate_strategy`, `kb_search`, `kb_log`, and `backtest`; runtime activation remains a resident trader or main-agent responsibility through `deploy_strategy`.

**Tech Stack:** TypeScript ESM, existing sub-agent runner, existing tool registry, Vitest.

---

## Scope

This plan implements P2 from the roadmap:

- Strategist role no longer has `plan_strategy`, `plan_grid_strategy`, or `plan_ladder_strategy`.
- Strategist role gets `strategy_package` and `validate_strategy`.
- Strategist prompt describes the package-first workflow and never tells the LLM to commit runtime strategy rules.
- Delegate tool copy describes strategist as producing packages, not rules.
- Trade reviewer copy recommends package revisions and deployment lifecycle actions, not direct strategy creation.
- Direct `plan_*` tools remain import-registered for manual/debug compatibility in this slice.

This plan does not remove the old tools or rewrite them to create packages. That is deferred until after package validation and observability are stronger.

## Files

- Modify: `src/sub-agents.ts`
- Modify: `src/tools/delegate.ts`
- Modify: `src/strategy/reviewer.ts`
- Test: `test/strategist-kb.test.ts`
- Test: `test/sub-agents.test.ts`
- Test: `test/strategy-reviewer.test.ts`

## Task 1: Strategist Tool Policy

**Files:**
- Modify: `src/sub-agents.ts`
- Test: `test/strategist-kb.test.ts`

- [x] **Step 1: Write failing tests**

Update strategist role tests to assert:

```ts
expect(runner.allowedTools).toContain("strategy_package");
expect(runner.allowedTools).toContain("validate_strategy");
expect(runner.allowedTools).not.toContain("plan_strategy");
expect(runner.allowedTools).not.toContain("plan_grid_strategy");
expect(runner.allowedTools).not.toContain("plan_ladder_strategy");
```

Also assert the prompt includes `strategy_package.create` and excludes `plan_strategy`.

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategist-kb.test.ts -t "strategist"
```

Expected: fails because current strategist role still includes `plan_strategy`.

- [x] **Step 3: Implement strategist role change**

In `src/sub-agents.ts`:

- Replace prompt text that says "commit new strategy rules" with "create strategy packages".
- Replace PASS workflow with `strategy_package.create`, then `validate_strategy.run` for signal packages or `validate_strategy.waive_for_paper` for paper-only grid/ladder.
- Replace `rule_id` language with `package_id`.
- Remove direct `plan_*` tools from `ROLES.strategist.tools`.
- Add `strategy_package` and `validate_strategy`.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategist-kb.test.ts -t "strategist"
```

Expected: pass.

## Task 2: Delegate Copy

**Files:**
- Modify: `src/tools/delegate.ts`
- Test: `test/sub-agents.test.ts`

- [x] **Step 1: Write failing test**

Add or update a test that finds the `delegate` tool definition and asserts:

```ts
expect(delegate.description).toContain("strategy package");
expect(delegate.description).not.toContain("commit rule");
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/sub-agents.test.ts -t "delegate"
```

Expected: fails because current copy still says "commit rule".

- [x] **Step 3: Update copy**

In `src/tools/delegate.ts`, change strategist description to:

```text
strategist: hypothesize -> backtest -> create/validate strategy package OR log failure
```

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/sub-agents.test.ts -t "delegate"
```

Expected: pass.

## Task 3: Focused Verification

**Files:**
- Verify only.

- [x] **Step 1: Lock reviewer prompt to package-first guidance**

Added `test/strategy-reviewer.test.ts` to assert the review prompt mentions
`strategy package` and `deploy_strategy`, and no longer mentions
`plan_strategy`.

- [x] **Step 2: Update reviewer prompt**

Changed `src/strategy/reviewer.ts` so automatic performance reviews recommend
package revisions and deployment lifecycle actions instead of direct runtime
strategy creation.

- [x] **Step 3: Run focused tests**

Run:

```bash
npx vitest run test/strategist-kb.test.ts test/sub-agents.test.ts
```

Expected: pass.

- [x] **Step 4: Run package/resident regression**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts test/resident-agent-runtime.test.ts test/resident-agent-tool.test.ts
```

Expected: pass.

## Task 4: Full Verification

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
