import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SessionType } from "./session.js";
import type { StrategyRule, RiskParams, StrategyPersistence } from "./strategy/state.js";
import type { StrategySnapshot } from "./strategy/base.js";

export interface SessionRow {
  id: string;
  name: string;
  type: SessionType;
  created_at: string;
  last_active_at: string;
}

export interface TradeRow {
  id: number;
  session_id: string;
  strategy_id: string | null;
  symbol: string;
  side: string;
  amount: number;
  price: number;
  order_type: string;
  mode: string;
  reasoning: string;
  created_at: string;
}

export interface PersistedActivePosition {
  ruleId: string;
  strategyId: string | null;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  amount: number;
  stopLoss: number;
  takeProfit: number;
  enteredAt: number;
  source: string;
}

export interface PersistedPendingOrder {
  id: number;
  exchangeOrderId: string | null;
  sessionId: string | null;
  strategyId: string | null;
  positionId: string | null;
  action: "enter" | "exit" | null;
  symbol: string;
  side: string;
  orderType: string;
  price: number | null;
  amount: number;
  status: "open" | "filled" | "cancelled" | "unknown";
  createdAt: string;
}

export interface PortfolioWatermark {
  peakValue: number;
  peakAt: string;
}

export interface StrategyKbEntry {
  id: number;
  hypothesis: string;
  symbol: string | null;
  timeframe: string | null;
  backtestSummary: string | null;
  outcome: "adopted" | "rejected" | "pending_review";
  failureReason: string | null;
  ruleId: string | null;
  createdAt: string;
}

export class Memory {
  private db: Database.Database;

  constructor(dbPath = "crypto_agent.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
    this.migrate();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        strategy_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        amount REAL NOT NULL,
        price REAL NOT NULL,
        order_type TEXT DEFAULT 'market',
        mode TEXT DEFAULT 'PAPER',
        reasoning TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        cron_expr TEXT NOT NULL,
        next_run TIMESTAMP NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS strategy_rules (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS risk_params (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- A0: Active positions tracked by the OrderExecutor (local SL/TP metadata)
      -- rule_id is kept as the primary key for backwards compat; it doubles as
      -- the strategy_id since each position is owned by exactly one strategy.
      CREATE TABLE IF NOT EXISTS active_positions (
        rule_id TEXT PRIMARY KEY,
        strategy_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        amount REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit REAL NOT NULL,
        entered_at INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'fast_path',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- A1: Accumulated realized PnL per day (keyed by YYYY-MM-DD)
      CREATE TABLE IF NOT EXISTS daily_pnl (
        date TEXT PRIMARY KEY,
        realized_pnl REAL NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- A2: Pending/open orders awaiting fill
      CREATE TABLE IF NOT EXISTS pending_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange_order_id TEXT,
        session_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        order_type TEXT NOT NULL,
        price REAL,
        amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- A3: Peak portfolio watermark for dynamic drawdown
      CREATE TABLE IF NOT EXISTS portfolio_watermark (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        peak_value REAL NOT NULL,
        peak_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- B0: Daemon state KV (active soul, exchange, session, counters)
      CREATE TABLE IF NOT EXISTS daemon_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- B1: Polymorphic strategies (replaces strategy_rules). Each row is one
      -- Strategy instance; kind selects the concrete class, params carries
      -- the kind-specific config as JSON.
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        symbol TEXT NOT NULL,
        params TEXT NOT NULL,
        allocated_usdt REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- C0: Strategist research KB (hypotheses, backtests, outcomes, failure reasons)
      CREATE TABLE IF NOT EXISTS strategy_kb (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hypothesis TEXT NOT NULL,
        symbol TEXT,
        timeframe TEXT,
        backtest_summary TEXT,
        outcome TEXT NOT NULL,
        failure_reason TEXT,
        rule_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  private migrate(): void {
    const cols = this.db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
    const hasSessionId = cols.some((c) => c.name === "session_id");
    if (!hasSessionId) {
      const legacyId = randomUUID();
      this.db.exec(`
        ALTER TABLE conversations ADD COLUMN session_id TEXT REFERENCES sessions(id);
      `);
      this.db
        .prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)")
        .run(legacyId, "legacy", "user");
      this.db.prepare("UPDATE conversations SET session_id = ?").run(legacyId);
    }

    this.migrateLegacyRulesToStrategies();
    this.migrateAddStrategyIdColumn();
    this.migrateAddPendingOrderStrategyColumns();
  }

  /**
   * pending_orders needs strategy_id + position_id so OrderExecutor can
   * resume the right in-flight order when a limit fill arrives (Grid, Ladder
   * with limit entries, etc.).
   */
  private migrateAddPendingOrderStrategyColumns(): void {
    const cols = this.db.prepare("PRAGMA table_info(pending_orders)").all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("strategy_id")) {
      this.db.exec("ALTER TABLE pending_orders ADD COLUMN strategy_id TEXT");
    }
    if (!names.has("position_id")) {
      this.db.exec("ALTER TABLE pending_orders ADD COLUMN position_id TEXT");
    }
    if (!names.has("action")) {
      // "enter" or "exit" — tells executor which branch to run on fill.
      this.db.exec("ALTER TABLE pending_orders ADD COLUMN action TEXT");
    }
  }

  /**
   * Add strategy_id columns to legacy trades + active_positions tables so
   * budget accounting can attribute rows to a Strategy. Safe idempotent.
   */
  private migrateAddStrategyIdColumn(): void {
    const ensureColumn = (table: string, column: string, type: string) => {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    };
    ensureColumn("trades", "strategy_id", "TEXT");
    ensureColumn("active_positions", "strategy_id", "TEXT");
  }

  /**
   * One-shot migration: strategy_rules → strategies as kind='signal'.
   * Safe to re-run; only imports rows that don't already exist in strategies.
   */
  private migrateLegacyRulesToStrategies(): void {
    const tableExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='strategy_rules'")
      .get();
    if (!tableExists) return;

    const legacyRows = this.db
      .prepare("SELECT id, data FROM strategy_rules")
      .all() as Array<{ id: string; data: string }>;
    if (!legacyRows.length) return;

    const existsStmt = this.db.prepare("SELECT 1 FROM strategies WHERE id = ?");
    const insertStmt = this.db.prepare(
      `INSERT INTO strategies (id, kind, symbol, params, allocated_usdt, enabled, created_at, updated_at)
       VALUES (?, 'signal', ?, ?, 0, ?, ?, ?)`,
    );

    for (const row of legacyRows) {
      if (existsStmt.get(row.id)) continue;
      try {
        const rule = JSON.parse(row.data);
        const params = {
          timeframe: rule.timeframe ?? "1h",
          side: rule.side,
          entry: rule.entry,
          exit: rule.exit,
          positionSizeUsdt: rule.positionSizeUsdt,
          stopLossPct: rule.stopLossPct,
          takeProfitPct: rule.takeProfitPct,
        };
        insertStmt.run(
          rule.id,
          rule.symbol,
          JSON.stringify(params),
          rule.enabled ? 1 : 0,
          rule.createdAt,
          rule.updatedAt,
        );
      } catch (e) {
        console.warn(`[Memory] legacy rule ${row.id} skipped during migration:`, (e as any).message);
      }
    }
  }

  // --- Session CRUD ---

  createSession(id: string, name: string, type: SessionType): void {
    this.db
      .prepare("INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)")
      .run(id, name, type);
  }

  getSession(id: string): SessionRow | null {
    return (this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow) ?? null;
  }

  getSessionByName(name: string): SessionRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM sessions WHERE name = ? ORDER BY last_active_at DESC LIMIT 1")
        .get(name) as SessionRow) ?? null
    );
  }

  listSessions(type?: SessionType): SessionRow[] {
    if (type) {
      return this.db
        .prepare("SELECT * FROM sessions WHERE type = ? ORDER BY last_active_at DESC")
        .all(type) as SessionRow[];
    }
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY last_active_at DESC")
      .all() as SessionRow[];
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM conversations WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM session_summaries WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  touchSession(id: string): void {
    this.db
      .prepare("UPDATE sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(id);
  }

  // --- Conversation (session-aware) ---

  saveMessage(sessionId: string, role: string, content: string | any): void {
    const c = typeof content === "string" ? content : JSON.stringify(content);
    this.db
      .prepare("INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)")
      .run(sessionId, role, c);
    this.touchSession(sessionId);
  }

  loadRecentMessages(sessionId: string, limit = 50): Array<{ role: string; content: any }> {
    const rows = this.db
      .prepare(
        "SELECT role, content FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(sessionId, limit) as Array<{ role: string; content: string }>;
    return rows.reverse().map(({ role, content }) => {
      try {
        return { role, content: JSON.parse(content) };
      } catch {
        return { role, content };
      }
    });
  }

  // --- Trade Journal ---

  logTrade(
    sessionId: string,
    data: {
      symbol: string;
      side: string;
      amount: number;
      price: number;
      order_type?: string;
      mode?: string;
      reasoning?: string;
      strategyId?: string | null;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO trades (session_id, strategy_id, symbol, side, amount, price, order_type, mode, reasoning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        data.strategyId ?? null,
        data.symbol,
        data.side,
        data.amount,
        data.price,
        data.order_type ?? "market",
        data.mode ?? "PAPER",
        data.reasoning ?? "",
      );
  }

  getRecentTrades(limit = 20): TradeRow[] {
    return this.db
      .prepare("SELECT * FROM trades ORDER BY id DESC LIMIT ?")
      .all(limit) as TradeRow[];
  }

  getTradesBySession(sessionId: string, limit = 50): TradeRow[] {
    return this.db
      .prepare("SELECT * FROM trades WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionId, limit) as TradeRow[];
  }

  getTradesByStrategy(strategyId: string, limit = 500): TradeRow[] {
    return this.db
      .prepare("SELECT * FROM trades WHERE strategy_id = ? ORDER BY id ASC LIMIT ?")
      .all(strategyId, limit) as TradeRow[];
  }

  // --- Session Summaries ---

  saveSessionSummary(sessionId: string, summary: string): void {
    this.db
      .prepare("INSERT INTO session_summaries (session_id, summary) VALUES (?, ?)")
      .run(sessionId, summary);
  }

  getSessionSummaries(
    sessionId: string,
    limit = 10,
  ): Array<{ summary: string; created_at: string }> {
    return this.db
      .prepare(
        "SELECT summary, created_at FROM session_summaries WHERE session_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(sessionId, limit) as Array<{ summary: string; created_at: string }>;
  }

  // --- Cron Jobs ---

  addCronJob(description: string, cronExpr: string, nextRun: string): number {
    const result = this.db
      .prepare("INSERT INTO cron_jobs (description, cron_expr, next_run) VALUES (?, ?, ?)")
      .run(description, cronExpr, nextRun);
    return Number(result.lastInsertRowid);
  }

  getDueCronJobs(): Array<{
    id: number;
    description: string;
    cron_expr: string;
    next_run: string;
  }> {
    const now = new Date().toISOString();
    return this.db
      .prepare(
        "SELECT id, description, cron_expr, next_run FROM cron_jobs WHERE enabled=1 AND next_run <= ?",
      )
      .all(now) as any[];
  }

  updateCronNextRun(jobId: number, nextRun: string): void {
    this.db.prepare("UPDATE cron_jobs SET next_run = ? WHERE id = ?").run(nextRun, jobId);
  }

  listCronJobs(): Array<{
    id: number;
    description: string;
    cron_expr: string;
    next_run: string;
    enabled: boolean;
  }> {
    const rows = this.db
      .prepare("SELECT id, description, cron_expr, next_run, enabled FROM cron_jobs ORDER BY id")
      .all() as any[];
    return rows.map((r: any) => ({ ...r, enabled: Boolean(r.enabled) }));
  }

  deleteCronJob(jobId: number): void {
    this.db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(jobId);
  }

  // --- Events ---

  logEvent(eventType: string, data = ""): void {
    this.db
      .prepare("INSERT INTO events (event_type, data) VALUES (?, ?)")
      .run(eventType, data);
  }

  // --- Strategy Persistence (implements StrategyPersistence) ---

  saveRule(rule: StrategyRule): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO strategy_rules (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(rule.id, JSON.stringify(rule), rule.createdAt, rule.updatedAt);
  }

  deleteRule(id: string): void {
    this.db.prepare("DELETE FROM strategy_rules WHERE id = ?").run(id);
  }

  loadAllRules(): StrategyRule[] {
    const rows = this.db
      .prepare("SELECT data FROM strategy_rules ORDER BY created_at")
      .all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as StrategyRule);
  }

  // ── B1: polymorphic strategies persistence ──────────────────────────────

  saveStrategy(snap: StrategySnapshot): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO strategies
         (id, kind, symbol, params, allocated_usdt, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snap.id,
        snap.kind,
        snap.symbol,
        JSON.stringify(snap.params),
        snap.allocatedUsdt,
        snap.enabled ? 1 : 0,
        snap.createdAt,
        snap.updatedAt,
      );
  }

  deleteStrategy(id: string): void {
    this.db.prepare("DELETE FROM strategies WHERE id = ?").run(id);
  }

  loadAllStrategies(): StrategySnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, symbol, params, allocated_usdt, enabled, created_at, updated_at
         FROM strategies ORDER BY created_at`,
      )
      .all() as Array<{
        id: string;
        kind: string;
        symbol: string;
        params: string;
        allocated_usdt: number;
        enabled: number;
        created_at: string;
        updated_at: string;
      }>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      symbol: r.symbol,
      params: JSON.parse(r.params),
      allocatedUsdt: r.allocated_usdt,
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  saveRiskParams(params: RiskParams): void {
    this.db
      .prepare("INSERT OR REPLACE INTO risk_params (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)")
      .run(JSON.stringify(params));
  }

  loadRiskParams(): RiskParams | null {
    const row = this.db
      .prepare("SELECT data FROM risk_params WHERE id = 1")
      .get() as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as RiskParams) : null;
  }

  // --- A0: Active position persistence ---

  saveActivePosition(pos: PersistedActivePosition): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO active_positions
         (rule_id, strategy_id, symbol, side, entry_price, amount, stop_loss, take_profit, entered_at, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        pos.ruleId,
        pos.strategyId ?? pos.ruleId, // strategyId defaults to ruleId for legacy callers
        pos.symbol,
        pos.side,
        pos.entryPrice,
        pos.amount,
        pos.stopLoss,
        pos.takeProfit,
        pos.enteredAt,
        pos.source,
      );
  }

  deleteActivePosition(ruleId: string): void {
    this.db.prepare("DELETE FROM active_positions WHERE rule_id = ?").run(ruleId);
  }

  loadActivePositions(): PersistedActivePosition[] {
    const rows = this.db
      .prepare(
        `SELECT rule_id, strategy_id, symbol, side, entry_price, amount, stop_loss, take_profit, entered_at, source
         FROM active_positions ORDER BY entered_at ASC`,
      )
      .all() as Array<{
        rule_id: string;
        strategy_id: string | null;
        symbol: string;
        side: "long" | "short";
        entry_price: number;
        amount: number;
        stop_loss: number;
        take_profit: number;
        entered_at: number;
        source: string;
      }>;
    return rows.map((r) => ({
      ruleId: r.rule_id,
      strategyId: r.strategy_id,
      symbol: r.symbol,
      side: r.side,
      entryPrice: r.entry_price,
      amount: r.amount,
      stopLoss: r.stop_loss,
      takeProfit: r.take_profit,
      enteredAt: r.entered_at,
      source: r.source,
    }));
  }

  // --- A1: Daily realized PnL ---

  getDailyPnl(date: string): number {
    const row = this.db
      .prepare("SELECT realized_pnl FROM daily_pnl WHERE date = ?")
      .get(date) as { realized_pnl: number } | undefined;
    return row?.realized_pnl ?? 0;
  }

  addDailyPnl(date: string, delta: number): number {
    // Atomic read-modify-write via UPSERT
    this.db
      .prepare(
        `INSERT INTO daily_pnl (date, realized_pnl, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(date) DO UPDATE SET
           realized_pnl = realized_pnl + excluded.realized_pnl,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(date, delta);
    return this.getDailyPnl(date);
  }

  // --- A2: Pending orders tracking ---

  createPendingOrder(opts: {
    sessionId?: string | null;
    strategyId?: string | null;
    positionId?: string | null;
    action?: "enter" | "exit" | null;
    symbol: string;
    side: string;
    orderType: string;
    price?: number | null;
    amount: number;
    exchangeOrderId?: string | null;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO pending_orders
         (session_id, strategy_id, position_id, action, exchange_order_id, symbol, side, order_type, price, amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      )
      .run(
        opts.sessionId ?? null,
        opts.strategyId ?? null,
        opts.positionId ?? null,
        opts.action ?? null,
        opts.exchangeOrderId ?? null,
        opts.symbol,
        opts.side,
        opts.orderType,
        opts.price ?? null,
        opts.amount,
      );
    return Number(result.lastInsertRowid);
  }

  updatePendingOrder(id: number, patch: { exchangeOrderId?: string | null; status?: PersistedPendingOrder["status"] }): void {
    const fields: string[] = [];
    const values: any[] = [];
    if (patch.exchangeOrderId !== undefined) {
      fields.push("exchange_order_id = ?");
      values.push(patch.exchangeOrderId);
    }
    if (patch.status !== undefined) {
      fields.push("status = ?");
      values.push(patch.status);
    }
    if (!fields.length) return;
    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);
    this.db.prepare(`UPDATE pending_orders SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  private readonly pendingOrderCols =
    "id, exchange_order_id, session_id, strategy_id, position_id, action, symbol, side, order_type, price, amount, status, created_at";

  private rowToPendingOrder(r: any): PersistedPendingOrder {
    return {
      id: r.id,
      exchangeOrderId: r.exchange_order_id,
      sessionId: r.session_id,
      strategyId: r.strategy_id,
      positionId: r.position_id,
      action: r.action,
      symbol: r.symbol,
      side: r.side,
      orderType: r.order_type,
      price: r.price,
      amount: r.amount,
      status: r.status,
      createdAt: r.created_at,
    };
  }

  loadOpenPendingOrders(): PersistedPendingOrder[] {
    const rows = this.db
      .prepare(`SELECT ${this.pendingOrderCols} FROM pending_orders WHERE status = 'open' ORDER BY id ASC`)
      .all() as Array<any>;
    return rows.map((r) => this.rowToPendingOrder(r));
  }

  getOpenPendingOrdersByStrategy(strategyId: string): PersistedPendingOrder[] {
    const rows = this.db
      .prepare(
        `SELECT ${this.pendingOrderCols} FROM pending_orders
         WHERE status = 'open' AND strategy_id = ? ORDER BY id ASC`,
      )
      .all(strategyId) as Array<any>;
    return rows.map((r) => this.rowToPendingOrder(r));
  }

  getPendingOrderByExchangeId(exchangeOrderId: string): PersistedPendingOrder | null {
    const row = this.db
      .prepare(`SELECT ${this.pendingOrderCols} FROM pending_orders WHERE exchange_order_id = ?`)
      .get(exchangeOrderId) as any | undefined;
    return row ? this.rowToPendingOrder(row) : null;
  }

  // --- A3: Peak portfolio watermark ---

  getPortfolioWatermark(): PortfolioWatermark | null {
    const row = this.db
      .prepare("SELECT peak_value, peak_at FROM portfolio_watermark WHERE id = 1")
      .get() as { peak_value: number; peak_at: string } | undefined;
    return row ? { peakValue: row.peak_value, peakAt: row.peak_at } : null;
  }

  /**
   * Update peak only if the new value is higher. Returns the effective watermark
   * after the update (either the existing peak or the new one).
   */
  updatePortfolioWatermark(currentValue: number, at: string = new Date().toISOString()): PortfolioWatermark {
    const existing = this.getPortfolioWatermark();
    if (!existing || currentValue > existing.peakValue) {
      this.db
        .prepare(
          `INSERT INTO portfolio_watermark (id, peak_value, peak_at, updated_at)
           VALUES (1, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET
             peak_value = excluded.peak_value,
             peak_at = excluded.peak_at,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .run(currentValue, at);
      return { peakValue: currentValue, peakAt: at };
    }
    return existing;
  }

  // --- B0: Daemon state KV ---

  getDaemonState(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM daemon_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setDaemonState(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO daemon_state (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(key, value);
  }

  deleteDaemonState(key: string): void {
    this.db.prepare("DELETE FROM daemon_state WHERE key = ?").run(key);
  }

  // --- C0: Strategist research KB ---

  logResearch(entry: {
    hypothesis: string;
    symbol?: string | null;
    timeframe?: string | null;
    backtestSummary?: string | null;
    outcome: StrategyKbEntry["outcome"];
    failureReason?: string | null;
    ruleId?: string | null;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO strategy_kb
         (hypothesis, symbol, timeframe, backtest_summary, outcome, failure_reason, rule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.hypothesis,
        entry.symbol ?? null,
        entry.timeframe ?? null,
        entry.backtestSummary ?? null,
        entry.outcome,
        entry.failureReason ?? null,
        entry.ruleId ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  searchResearchKb(opts: { query?: string; outcome?: StrategyKbEntry["outcome"]; limit?: number } = {}): StrategyKbEntry[] {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    const clauses: string[] = [];
    const values: any[] = [];
    if (opts.query && opts.query.trim()) {
      const q = `%${opts.query.trim()}%`;
      clauses.push("(hypothesis LIKE ? OR failure_reason LIKE ? OR symbol LIKE ?)");
      values.push(q, q, q);
    }
    if (opts.outcome) {
      clauses.push("outcome = ?");
      values.push(opts.outcome);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit);
    const rows = this.db
      .prepare(
        `SELECT id, hypothesis, symbol, timeframe, backtest_summary, outcome, failure_reason, rule_id, created_at
         FROM strategy_kb ${where} ORDER BY id DESC LIMIT ?`,
      )
      .all(...values) as Array<any>;
    return rows.map((r) => ({
      id: r.id,
      hypothesis: r.hypothesis,
      symbol: r.symbol,
      timeframe: r.timeframe,
      backtestSummary: r.backtest_summary,
      outcome: r.outcome,
      failureReason: r.failure_reason,
      ruleId: r.rule_id,
      createdAt: r.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
