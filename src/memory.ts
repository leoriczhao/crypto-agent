import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SessionType } from "./session.js";
import type { StrategyRule, RiskParams, StrategyPersistence } from "./strategy/state.js";

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
  symbol: string;
  side: string;
  amount: number;
  price: number;
  order_type: string;
  mode: string;
  reasoning: string;
  created_at: string;
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
    `);
  }

  private migrate(): void {
    const cols = this.db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
    const hasSessionId = cols.some((c) => c.name === "session_id");
    if (hasSessionId) return;

    const legacyId = randomUUID();
    this.db.exec(`
      ALTER TABLE conversations ADD COLUMN session_id TEXT REFERENCES sessions(id);
    `);
    this.db
      .prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)")
      .run(legacyId, "legacy", "user");
    this.db.prepare("UPDATE conversations SET session_id = ?").run(legacyId);
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
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO trades (session_id, symbol, side, amount, price, order_type, mode, reasoning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
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

  close(): void {
    this.db.close();
  }
}
