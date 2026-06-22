# Signal Package Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `validate_strategy.run` so signal strategy packages record repeatable backtest evidence before becoming `paper_ready`.

**Architecture:** Keep package compiler validation as the first gate. For `signal` executable specs, fetch OHLCV candles for each package symbol, run the existing condition-based `BacktestEngine`, store metrics in `strategy_validations`, and mark the package `paper_ready` only when every symbol passes the paper thresholds. For `grid` and `ladder`, `run` remains schema/compiler validation only and does not mark them paper-ready; they still require explicit paper waiver.

**Tech Stack:** TypeScript ESM, existing `MarketDataProvider`, existing `BacktestEngine`, SQLite validation records, Vitest.

---

## Scope

This plan implements P3's first practical slice:

- `validate_strategy.run` depends on `market_data`.
- Signal packages run condition-based backtests using their own `entry`, `exit`, `side`, `symbols`, and `timeframe`.
- Validation metrics store per-symbol total return, max drawdown, Sharpe, win rate, total trades, candle count, and threshold pass/fail reason.
- Passing signal validation sets package validation to `passed` and status to `paper_ready`.
- Failing signal validation sets package validation to `failed` and keeps package status non-deployable.
- Grid and ladder `run` records compiler-only validation as `pending` and tells the caller to use explicit paper waiver until simulators exist.
- Sub-agent tool dispatch injects `market_data` so package-first strategist runs can call `validate_strategy.run`.

This plan does not implement grid/ladder simulators, walk-forward testing, live promotion, or optimizer search.

## Files

- Modify: `src/tools/validate-strategy.ts`
- Modify: `src/sub-agents.ts`
- Test: `test/strategy-package-tools.test.ts`
- Test: `test/strategist-kb.test.ts`
- Test: `test/sub-agents.test.ts`

## Task 1: Signal Backtest Pass

**Files:**
- Modify: `src/tools/validate-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing pass test**

Add a test that creates a `signal` package, calls `validate_strategy.run` with a mock `market_data.fetchOhlcv`, and expects:

```ts
expect(result).toContain("validation=passed");
expect(result).toContain("backtest");
expect(memory.getStrategyPackage("btc_signal", 1)).toMatchObject({
  status: "paper_ready",
  validationStatus: "passed",
});
expect(memory.listStrategyValidations("btc_signal", 1)[0].metrics.backtests[0]).toMatchObject({
  symbol: "BTC/USDT:USDT",
  timeframe: "1h",
  passed: true,
});
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "runs signal validation backtest"
```

Expected: fails because current tool only records compiler validation and has no market data dependency.

- [x] **Step 3: Implement signal validation**

In `src/tools/validate-strategy.ts`:

- Add `market_data` dependency.
- For `spec.kind === "signal"`, fetch 300 candles per symbol.
- Run `BacktestEngine(10000).runConditionBased(ohlcv, spec.entry, spec.exit, spec.side, symbol, spec.timeframe)`.
- Pass thresholds:
  - `totalTrades >= 10`
  - `sharpeRatio > 0.3`
  - `maxDrawdown < 25`
- Create one validation row with `validatorType: "backtest_signal"` and metrics containing compiler and backtests.
- Set package validation/status to `passed`/`paper_ready` only if all symbols pass.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "runs signal validation backtest"
```

Expected: pass.

## Task 2: Signal Backtest Failure

**Files:**
- Modify: `src/tools/validate-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing failure test**

Add a test with flat candles and impossible entry/exit conditions. Expect:

```ts
expect(result).toContain("validation=failed");
expect(memory.getStrategyPackage("flat_signal", 1)).toMatchObject({
  status: "submitted",
  validationStatus: "failed",
});
expect(memory.listStrategyValidations("flat_signal", 1)[0].metrics.backtests[0].passed).toBe(false);
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "fails signal validation"
```

Expected: fails until failure status is implemented.

- [x] **Step 3: Implement failure handling**

If any symbol fails thresholds, create a failed validation row, set package
validation to `failed`, keep package status `submitted` unless it was already a
terminal `rejected`/`deprecated`, and return concise failure reasons.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "fails signal validation"
```

Expected: pass.

## Task 3: Grid/Ladder Run Does Not Approve

**Files:**
- Modify: `src/tools/validate-strategy.ts`
- Test: `test/strategy-package-tools.test.ts`

- [x] **Step 1: Write failing test**

Add a grid package test that calls `validate_strategy.run` and expects:

```ts
expect(result).toContain("validation=pending");
expect(result).toContain("waive_for_paper");
expect(memory.getStrategyPackage("eth_grid", 1)).toMatchObject({
  status: "submitted",
  validationStatus: "pending",
});
```

- [x] **Step 2: Run RED**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "does not approve grid"
```

Expected: fails because current compiler validation marks every kind paper-ready.

- [x] **Step 3: Implement non-signal pending path**

For `grid` and `ladder`, after compile succeeds, create validation with
`validatorType: "compiler"`, `status: "pending"`, metrics explaining simulator
absence, and do not mark paper-ready.

- [x] **Step 4: Run GREEN**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts -t "does not approve grid"
```

Expected: pass.

## Task 4: Prompt Consistency

**Files:**
- Modify: `src/sub-agents.ts`
- Test: `test/strategist-kb.test.ts`

- [x] **Step 1: Write assertion**

Add an assertion that strategist prompt mentions the concrete validation
thresholds and paper waiver boundary.

- [x] **Step 2: Run RED if needed**

Run:

```bash
npx vitest run test/strategist-kb.test.ts -t "strategy packages"
```

- [x] **Step 3: Update prompt only if assertion fails**

Keep the prompt consistent with the validation tool thresholds.

## Task 5: Verification

**Files:**
- Verify only.

- [x] **Step 1: Lock sub-agent market data injection**

Added `test/sub-agents.test.ts` coverage that runs a fake OpenAI strategist tool
call into `validate_strategy.run` and expects a signal backtest to pass. This
failed before `market_data` was added to sub-agent dependency injection.

- [x] **Step 2: Focused tests**

Run:

```bash
npx vitest run test/strategy-package-tools.test.ts test/strategist-kb.test.ts
```

Expected: pass.

- [x] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [x] **Step 4: Full tests**

Run:

```bash
npm test
```

Expected: pass.

- [x] **Step 5: Diff check**

Run:

```bash
git diff --check
```

Expected: pass.
