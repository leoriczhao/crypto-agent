# Account Bot Session Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit FundingAccount -> TradingAccount -> Bot -> Session identity mapping while keeping the current runtime to one active bot.

**Architecture:** The trading layer remains unchanged. A new persistence identity layer seeds one default funding account, trading account, and bot, then binds sessions and trading records to that default bot so no behavior changes for existing users. Later multi-bot execution can build on the same IDs without reinterpreting historical data.

**Tech Stack:** TypeScript, SQLite via better-sqlite3, Vitest, existing daemon/session/exchange abstractions.

---

## Files

- Modify: `src/memory.ts`
  - Add identity row interfaces.
  - Add `funding_accounts`, `trading_accounts`, `trading_bots`, and session/trade/order/position/strategy identity columns.
  - Add idempotent default identity seeding and lookup helpers.
  - Keep existing APIs backwards-compatible by defaulting new columns to the active/default bot context.
- Modify: `src/daemon.ts`
  - Initialize default identity after daemon state/exchange restore.
  - Bind restored and newly created sessions to the default bot.
  - Persist active bot/account daemon state for display and future routing.
- Modify: `src/ipc/protocol.ts` and `src/ipc/server.ts`
  - Include bot/account identity in daemon welcome metadata.
- Modify: `src/tools/session.ts` and `src/tools/switch-exchange.ts`
  - Keep tool-created sessions and exchange switches aligned with default identity.
- Modify: `test/memory.test.ts`
  - Test identity seeding and session binding.
  - Test trades inherit bot/account identity.
- Modify: `test/persistence.test.ts`
  - Test pending orders and active positions persist identity metadata.
- Modify: `test/ipc-e2e.test.ts`
  - Test welcome metadata includes bot/account identity.

## Task 1: Persistence Identity Model

**Files:**
- Modify: `src/memory.ts`
- Test: `test/memory.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that assert a fresh database creates one default funding account, one default trading account, and one default bot, and that sessions can bind to that bot.

- [x] **Step 2: Run tests to verify RED**

Run: `npx vitest run test/memory.test.ts -t "identity"`

Expected: FAIL because identity helpers do not exist yet.

- [x] **Step 3: Implement minimal identity schema**

Add tables and helpers in `Memory`:

- `ensureDefaultIdentity(opts)`
- `getDefaultBot()`
- `getSessionBinding(sessionId)`
- `bindSessionToBot(sessionId, botId)`
- `listTradingBots()`

Keep IDs stable and deterministic enough for repeated startup: `default-funding`, `default-trading-${exchangeId}-${mode}`, and `default-bot`.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `npx vitest run test/memory.test.ts -t "identity"`

Expected: PASS.

## Task 2: Trading Record Attribution

**Files:**
- Modify: `src/memory.ts`
- Test: `test/memory.test.ts`
- Test: `test/persistence.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that `logTrade`, `createPendingOrder`, and `saveActivePosition` store `trading_account_id` and `bot_id` when provided, and preserve old call sites when omitted.

- [x] **Step 2: Run tests to verify RED**

Run: `npx vitest run test/memory.test.ts test/persistence.test.ts -t "bot|account|identity"`

Expected: FAIL because row interfaces and SQL do not include the new columns.

- [x] **Step 3: Implement minimal record attribution**

Add nullable columns to:

- `trades`
- `pending_orders`
- `active_positions`
- `strategies`

Update row mappers and write APIs so new optional fields are persisted without breaking existing callers.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `npx vitest run test/memory.test.ts test/persistence.test.ts -t "bot|account|identity"`

Expected: PASS.

## Task 3: Daemon Default Binding

**Files:**
- Modify: `src/daemon.ts`
- Test: existing daemon/session behavior through full build and targeted tests.

- [x] **Step 1: Add tests if an existing seam is available**

Prefer testing through `Memory` because `CryptoDaemon` is currently not exported and importing `src/daemon.ts` starts the process.

- [x] **Step 2: Implement daemon startup binding**

In the daemon constructor:

- restore exchange first
- call `memory.ensureDefaultIdentity({ exchangeId, mode, name })`
- persist `active_bot_id` and `active_trading_account_id`
- when `ensureSession()` creates/restores a session, bind it to the active bot if it has no binding
- when `/new` creates a session, bind it to the active bot

- [x] **Step 3: Keep user-visible behavior unchanged**

`/sessions`, `/current`, `/budget`, `/trades`, and status should continue to work. Add bot/account labels only where useful and low-risk.

## Task 4: Verification

**Files:**
- Build/test only.

- [x] **Step 1: Run focused tests**

Run: `npx vitest run test/memory.test.ts test/persistence.test.ts`

Expected: PASS.

- [x] **Step 2: Run full tests**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Build**

Run: `npm run build`

Expected: PASS.

## Self-Review

- Scope stays inside identity mapping and default routing.
- No multi-bot scheduler, no separate strategy runtimes, no trading algorithm changes.
- Existing old calls remain valid because new IDs are optional in write APIs.

## Completion Evidence

- Focused tests: `npx vitest run test/memory.test.ts test/persistence.test.ts` passed with 42 tests.
- Full tests: `npm test` passed with 30 files, 244 tests passed, 1 skipped.
- Build: `npm run build` completed successfully.
