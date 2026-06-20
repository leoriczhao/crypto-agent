import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SessionType } from "./session.js";
import type { RiskParams } from "./strategy/state.js";
import type { StrategySnapshot } from "./strategy/base.js";

export interface SessionRow {
  id: string;
  name: string;
  type: SessionType;
  bot_id: string | null;
  created_at: string;
  last_active_at: string;
}

export interface TradeRow {
  id: number;
  session_id: string;
  strategy_id: string | null;
  agentRunId: string | null;
  mandateId: string | null;
  capitalAllocationId: string | null;
  symbol: string;
  side: string;
  amount: number;
  price: number;
  order_type: string;
  mode: string;
  reasoning: string;
  created_at: string;
  botId: string | null;
  tradingAccountId: string | null;
}

export interface FundingAccountRow {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradingAccountRow {
  id: string;
  fundingAccountId: string;
  exchangeId: string;
  mode: string;
  label: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradingBotRow {
  id: string;
  tradingAccountId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotAllocationRow {
  id: string;
  botId: string;
  tradingAccountId: string;
  asset: string;
  allocated: number;
  free: number;
  used: number;
  realizedPnl: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaperOrderRow {
  id: string;
  tradingAccountId: string;
  botId: string;
  actorType: string;
  actorId: string | null;
  agentRunId: string | null;
  mandateId: string | null;
  capitalAllocationId: string | null;
  symbol: string;
  marketType: "spot" | "swap";
  side: string;
  positionSide: "long" | "short" | null;
  orderType: "market" | "limit";
  amount: number;
  price: number | null;
  leverage: number | null;
  reduceOnly: boolean;
  status: string;
  createdAt: string;
  filledAt: string | null;
}

export interface PaperOrderInsert {
  id: string;
  tradingAccountId: string;
  botId: string;
  actorType: string;
  actorId?: string | null;
  agentRunId?: string | null;
  mandateId?: string | null;
  capitalAllocationId?: string | null;
  symbol: string;
  marketType: "spot" | "swap";
  side: string;
  positionSide?: "long" | "short" | null;
  orderType: "market" | "limit";
  amount: number;
  price?: number | null;
  leverage?: number | null;
  reduceOnly?: boolean;
  status: string;
  filledAt?: string | null;
}

export interface PaperPositionRow {
  id: string;
  tradingAccountId: string;
  botId: string;
  symbol: string;
  marketType: "spot" | "swap";
  positionSide: "long" | "short";
  amount: number;
  avgEntryPrice: number;
  markPrice: number;
  leverage: number;
  marginUsdt: number;
  unrealizedPnl: number;
  realizedPnl: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaperFillRow {
  id: number;
  orderId: string;
  tradingAccountId: string;
  botId: string;
  actorType: string;
  actorId: string | null;
  agentRunId: string | null;
  mandateId: string | null;
  capitalAllocationId: string | null;
  symbol: string;
  marketType: "spot" | "swap";
  side: string;
  positionSide: "long" | "short" | null;
  amount: number;
  price: number;
  feeUsdt: number;
  realizedPnl: number;
  createdAt: string;
}

export interface PaperFillInsert {
  orderId: string;
  tradingAccountId: string;
  botId: string;
  actorType: string;
  actorId?: string | null;
  agentRunId?: string | null;
  mandateId?: string | null;
  capitalAllocationId?: string | null;
  symbol: string;
  marketType: "spot" | "swap";
  side: string;
  positionSide?: "long" | "short" | null;
  amount: number;
  price: number;
  feeUsdt?: number;
  realizedPnl?: number;
}

export type ResidentAgentType = "trader" | "researcher" | "risk_monitor" | "strategist";
export type ResidentAgentStatus = "active" | "paused" | "archived";
export type StrategyMandateStatus = "draft" | "active" | "deprecated";
export type MandateValidationStatus = "deferred" | "pending" | "validated" | "rejected";
export type AgentRunStatus = "running" | "completed" | "failed";

export interface StrategyMandateRow {
  id: string;
  name: string;
  version: number;
  status: StrategyMandateStatus;
  description: string;
  body: Record<string, any>;
  validationStatus: MandateValidationStatus;
  validationNotes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResidentAgentRow {
  id: string;
  type: ResidentAgentType;
  name: string;
  status: ResidentAgentStatus;
  sessionId: string;
  botId: string;
  tradingAccountId: string;
  capitalAllocationId: string | null;
  scheduleExpr: string | null;
  nextRun: string | null;
  mandate: string;
  toolPolicy: string;
  riskPolicy: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMandateAssignmentRow {
  id: number;
  agentId: string;
  mandateId: string;
  universe: string[];
  priority: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunRow {
  id: string;
  agentId: string;
  trigger: string;
  status: AgentRunStatus;
  input: string | null;
  summary: string | null;
  error: string | null;
  mandateIds: string[];
  startedAt: string;
  finishedAt: string | null;
}

export interface DefaultIdentity {
  fundingAccount: FundingAccountRow;
  tradingAccount: TradingAccountRow;
  bot: TradingBotRow;
}

export interface SessionBinding {
  sessionId: string;
  botId: string;
  tradingAccountId: string;
  fundingAccountId: string;
}

export interface PersistedActivePosition {
  ruleId: string;
  strategyId: string | null;
  botId?: string | null;
  tradingAccountId?: string | null;
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
  botId: string | null;
  tradingAccountId: string | null;
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
  private defaultBotId: string | null = null;
  private defaultTradingAccountId: string | null = null;

  constructor(dbPath = "crypto_agent.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS funding_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_currency TEXT NOT NULL DEFAULT 'USDT',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS trading_accounts (
        id TEXT PRIMARY KEY,
        funding_account_id TEXT NOT NULL,
        exchange_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (funding_account_id) REFERENCES funding_accounts(id)
      );

      CREATE TABLE IF NOT EXISTS trading_bots (
        id TEXT PRIMARY KEY,
        trading_account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trading_account_id) REFERENCES trading_accounts(id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'user',
        bot_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bot_id) REFERENCES trading_bots(id)
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
        agent_run_id TEXT,
        mandate_id TEXT,
        capital_allocation_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        amount REAL NOT NULL,
        price REAL NOT NULL,
        order_type TEXT DEFAULT 'market',
        mode TEXT DEFAULT 'PAPER',
        reasoning TEXT DEFAULT '',
        bot_id TEXT,
        trading_account_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (bot_id) REFERENCES trading_bots(id),
        FOREIGN KEY (trading_account_id) REFERENCES trading_accounts(id)
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

      CREATE TABLE IF NOT EXISTS risk_params (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- A0: Active positions tracked by the OrderExecutor (local SL/TP metadata)
      CREATE TABLE IF NOT EXISTS active_positions (
        rule_id TEXT PRIMARY KEY,
        strategy_id TEXT,
        bot_id TEXT,
        trading_account_id TEXT,
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
        strategy_id TEXT,
        bot_id TEXT,
        trading_account_id TEXT,
        position_id TEXT,
        action TEXT,
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

      -- B1: Polymorphic strategies. Each row is one Strategy instance; kind
      -- selects the concrete class, params carries kind-specific config as JSON.
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        symbol TEXT NOT NULL,
        params TEXT NOT NULL,
        allocated_usdt REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        bot_id TEXT,
        trading_account_id TEXT,
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

      CREATE TABLE IF NOT EXISTS bot_allocations (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        trading_account_id TEXT NOT NULL,
        asset TEXT NOT NULL DEFAULT 'USDT',
        allocated REAL NOT NULL,
        free REAL NOT NULL,
        used REAL NOT NULL DEFAULT 0,
        realized_pnl REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS paper_orders (
        id TEXT PRIMARY KEY,
        trading_account_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        agent_run_id TEXT,
        mandate_id TEXT,
        capital_allocation_id TEXT,
        symbol TEXT NOT NULL,
        market_type TEXT NOT NULL,
        side TEXT NOT NULL,
        position_side TEXT,
        order_type TEXT NOT NULL,
        amount REAL NOT NULL,
        price REAL,
        leverage REAL,
        reduce_only INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        filled_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS paper_positions (
        id TEXT PRIMARY KEY,
        trading_account_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        market_type TEXT NOT NULL,
        position_side TEXT NOT NULL,
        amount REAL NOT NULL,
        avg_entry_price REAL NOT NULL,
        mark_price REAL NOT NULL,
        leverage REAL NOT NULL DEFAULT 1,
        margin_usdt REAL NOT NULL DEFAULT 0,
        unrealized_pnl REAL NOT NULL DEFAULT 0,
        realized_pnl REAL NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS paper_fills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        trading_account_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        agent_run_id TEXT,
        mandate_id TEXT,
        capital_allocation_id TEXT,
        symbol TEXT NOT NULL,
        market_type TEXT NOT NULL,
        side TEXT NOT NULL,
        position_side TEXT,
        amount REAL NOT NULL,
        price REAL NOT NULL,
        fee_usdt REAL NOT NULL DEFAULT 0,
        realized_pnl REAL NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS strategy_mandates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        description TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '{}',
        validation_status TEXT NOT NULL DEFAULT 'deferred',
        validation_notes TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS resident_agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        session_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        trading_account_id TEXT NOT NULL,
        capital_allocation_id TEXT,
        schedule_expr TEXT,
        next_run TIMESTAMP,
        mandate TEXT NOT NULL DEFAULT '',
        tool_policy TEXT NOT NULL DEFAULT '',
        risk_policy TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (bot_id) REFERENCES trading_bots(id),
        FOREIGN KEY (trading_account_id) REFERENCES trading_accounts(id)
      );

      CREATE TABLE IF NOT EXISTS agent_mandate_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        mandate_id TEXT NOT NULL,
        universe TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 100,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES resident_agents(id),
        FOREIGN KEY (mandate_id) REFERENCES strategy_mandates(id)
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        input TEXT,
        summary TEXT,
        error TEXT,
        mandate_ids TEXT NOT NULL DEFAULT '[]',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES resident_agents(id)
      );

      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        run_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES resident_agents(id),
        FOREIGN KEY (run_id) REFERENCES agent_runs(id)
      );

    `);
  }

  private identityKeyPart(value: string): string {
    const key = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    return key || "default";
  }

  private botIdOrDefault(botId?: string | null): string | null {
    return botId === undefined ? this.defaultBotId : botId;
  }

  private tradingAccountIdOrDefault(tradingAccountId?: string | null): string | null {
    return tradingAccountId === undefined ? this.defaultTradingAccountId : tradingAccountId;
  }

  private parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private rowToFundingAccount(r: any): FundingAccountRow {
    return {
      id: r.id,
      name: r.name,
      baseCurrency: r.base_currency,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private rowToTradingAccount(r: any): TradingAccountRow {
    return {
      id: r.id,
      fundingAccountId: r.funding_account_id,
      exchangeId: r.exchange_id,
      mode: r.mode,
      label: r.label,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private rowToTradingBot(r: any): TradingBotRow {
    return {
      id: r.id,
      tradingAccountId: r.trading_account_id,
      name: r.name,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // --- Identity model ---

  ensureDefaultIdentity(opts: {
    exchangeId: string;
    mode: string;
    name?: string;
    baseCurrency?: string;
  }): DefaultIdentity {
    const mode = opts.mode.toUpperCase();
    const exchangeId = opts.exchangeId.trim() || "default";
    const name = opts.name?.trim() || "default";
    const fundingId = "default-funding";
    const tradingAccountId = `default-trading-${this.identityKeyPart(exchangeId)}-${this.identityKeyPart(mode)}`;
    const botId = "default-bot";

    this.db
      .prepare(
        `INSERT INTO funding_accounts (id, name, base_currency)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           base_currency = excluded.base_currency,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(fundingId, name, opts.baseCurrency ?? "USDT");

    this.db
      .prepare(
        `INSERT INTO trading_accounts (id, funding_account_id, exchange_id, mode, label, status)
         VALUES (?, ?, ?, ?, ?, 'active')
         ON CONFLICT(id) DO UPDATE SET
           funding_account_id = excluded.funding_account_id,
           exchange_id = excluded.exchange_id,
           mode = excluded.mode,
           label = excluded.label,
           status = 'active',
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(tradingAccountId, fundingId, exchangeId, mode, `${name}:${exchangeId}:${mode}`);

    this.db
      .prepare(
        `INSERT INTO trading_bots (id, trading_account_id, name, status)
         VALUES (?, ?, ?, 'active')
         ON CONFLICT(id) DO UPDATE SET
           trading_account_id = excluded.trading_account_id,
           name = excluded.name,
           status = 'active',
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(botId, tradingAccountId, name);

    this.defaultBotId = botId;
    this.defaultTradingAccountId = tradingAccountId;

    return {
      fundingAccount: this.getFundingAccount(fundingId)!,
      tradingAccount: this.getTradingAccount(tradingAccountId)!,
      bot: this.getTradingBot(botId)!,
    };
  }

  getFundingAccount(id: string): FundingAccountRow | null {
    const row = this.db.prepare("SELECT * FROM funding_accounts WHERE id = ?").get(id);
    return row ? this.rowToFundingAccount(row) : null;
  }

  getTradingAccount(id: string): TradingAccountRow | null {
    const row = this.db.prepare("SELECT * FROM trading_accounts WHERE id = ?").get(id);
    return row ? this.rowToTradingAccount(row) : null;
  }

  getTradingBot(id: string): TradingBotRow | null {
    const row = this.db.prepare("SELECT * FROM trading_bots WHERE id = ?").get(id);
    return row ? this.rowToTradingBot(row) : null;
  }

  createTradingBot(input: {
    id?: string;
    tradingAccountId: string;
    name: string;
    status?: string;
  }): TradingBotRow {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO trading_bots (id, trading_account_id, name, status)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, input.tradingAccountId, input.name, input.status ?? "active");
    return this.getTradingBot(id)!;
  }

  getDefaultBot(): TradingBotRow | null {
    return this.getTradingBot("default-bot");
  }

  listTradingBots(): TradingBotRow[] {
    const rows = this.db.prepare("SELECT * FROM trading_bots ORDER BY created_at").all() as any[];
    return rows.map((r) => this.rowToTradingBot(r));
  }

  bindSessionToBot(sessionId: string, botId: string): void {
    const bot = this.getTradingBot(botId);
    if (!bot) throw new Error(`Trading bot not found: ${botId}`);
    this.db
      .prepare("UPDATE sessions SET bot_id = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(botId, sessionId);
  }

  getSessionBinding(sessionId: string): SessionBinding | null {
    const row = this.db
      .prepare(
        `SELECT
           s.id AS session_id,
           b.id AS bot_id,
           ta.id AS trading_account_id,
           fa.id AS funding_account_id
         FROM sessions s
         JOIN trading_bots b ON b.id = s.bot_id
         JOIN trading_accounts ta ON ta.id = b.trading_account_id
         JOIN funding_accounts fa ON fa.id = ta.funding_account_id
         WHERE s.id = ?`,
      )
      .get(sessionId) as any | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      botId: row.bot_id,
      tradingAccountId: row.trading_account_id,
      fundingAccountId: row.funding_account_id,
    };
  }

  // --- Session CRUD ---

  createSession(id: string, name: string, type: SessionType, botId?: string | null): void {
    this.db
      .prepare("INSERT OR IGNORE INTO sessions (id, name, type, bot_id) VALUES (?, ?, ?, ?)")
      .run(id, name, type, botId ?? null);
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
      botId?: string | null;
      tradingAccountId?: string | null;
      agentRunId?: string | null;
      mandateId?: string | null;
      capitalAllocationId?: string | null;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO trades
         (session_id, strategy_id, agent_run_id, mandate_id, capital_allocation_id, bot_id, trading_account_id, symbol, side, amount, price, order_type, mode, reasoning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        data.strategyId ?? null,
        data.agentRunId ?? null,
        data.mandateId ?? null,
        data.capitalAllocationId ?? null,
        this.botIdOrDefault(data.botId),
        this.tradingAccountIdOrDefault(data.tradingAccountId),
        data.symbol,
        data.side,
        data.amount,
        data.price,
        data.order_type ?? "market",
        data.mode ?? "PAPER",
        data.reasoning ?? "",
      );
  }

  private rowToTrade(r: any): TradeRow {
    return {
      ...r,
      agentRunId: r.agent_run_id ?? null,
      mandateId: r.mandate_id ?? null,
      capitalAllocationId: r.capital_allocation_id ?? null,
      botId: r.bot_id ?? null,
      tradingAccountId: r.trading_account_id ?? null,
    } as TradeRow;
  }

  getRecentTrades(limit = 20): TradeRow[] {
    const rows = this.db
      .prepare("SELECT * FROM trades ORDER BY id DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map((r) => this.rowToTrade(r));
  }

  getTradesBySession(sessionId: string, limit = 50): TradeRow[] {
    const rows = this.db
      .prepare("SELECT * FROM trades WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionId, limit) as any[];
    return rows.map((r) => this.rowToTrade(r));
  }

  getTradesByStrategy(strategyId: string, limit = 500): TradeRow[] {
    const rows = this.db
      .prepare("SELECT * FROM trades WHERE strategy_id = ? ORDER BY id ASC LIMIT ?")
      .all(strategyId, limit) as any[];
    return rows.map((r) => this.rowToTrade(r));
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

  setCronJobEnabled(jobId: number, enabled: boolean): void {
    this.db.prepare("UPDATE cron_jobs SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, jobId);
  }

  // --- Events ---

  logEvent(eventType: string, data = ""): void {
    this.db
      .prepare("INSERT INTO events (event_type, data) VALUES (?, ?)")
      .run(eventType, data);
  }

  // ── B1: polymorphic strategies persistence ──────────────────────────────

  saveStrategy(snap: StrategySnapshot): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO strategies
         (id, kind, symbol, params, allocated_usdt, enabled, bot_id, trading_account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snap.id,
        snap.kind,
        snap.symbol,
        JSON.stringify(snap.params),
        snap.allocatedUsdt,
        snap.enabled ? 1 : 0,
        this.botIdOrDefault(snap.botId),
        this.tradingAccountIdOrDefault(snap.tradingAccountId),
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
        `SELECT id, kind, symbol, params, allocated_usdt, enabled, bot_id, trading_account_id, created_at, updated_at
         FROM strategies ORDER BY created_at`,
      )
      .all() as Array<{
        id: string;
        kind: string;
        symbol: string;
        params: string;
        allocated_usdt: number;
        enabled: number;
        bot_id: string | null;
        trading_account_id: string | null;
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
      botId: r.bot_id,
      tradingAccountId: r.trading_account_id,
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
         (rule_id, strategy_id, bot_id, trading_account_id, symbol, side, entry_price, amount, stop_loss, take_profit, entered_at, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        pos.ruleId,
        pos.strategyId ?? pos.ruleId,
        this.botIdOrDefault(pos.botId),
        this.tradingAccountIdOrDefault(pos.tradingAccountId),
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
        `SELECT rule_id, strategy_id, bot_id, trading_account_id, symbol, side, entry_price, amount, stop_loss, take_profit, entered_at, source
         FROM active_positions ORDER BY entered_at ASC`,
      )
      .all() as Array<{
        rule_id: string;
        strategy_id: string | null;
        bot_id: string | null;
        trading_account_id: string | null;
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
      botId: r.bot_id,
      tradingAccountId: r.trading_account_id,
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
    botId?: string | null;
    tradingAccountId?: string | null;
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
         (session_id, strategy_id, bot_id, trading_account_id, position_id, action, exchange_order_id, symbol, side, order_type, price, amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      )
      .run(
        opts.sessionId ?? null,
        opts.strategyId ?? null,
        this.botIdOrDefault(opts.botId),
        this.tradingAccountIdOrDefault(opts.tradingAccountId),
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
    "id, exchange_order_id, session_id, strategy_id, bot_id, trading_account_id, position_id, action, symbol, side, order_type, price, amount, status, created_at";

  private rowToPendingOrder(r: any): PersistedPendingOrder {
    return {
      id: r.id,
      exchangeOrderId: r.exchange_order_id,
      sessionId: r.session_id,
      strategyId: r.strategy_id,
      botId: r.bot_id,
      tradingAccountId: r.trading_account_id,
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

  // --- Paper broker persistence ---

  private paperAllocationId(botId: string, tradingAccountId: string, asset: string): string {
    return `${tradingAccountId}:${botId}:${asset.toUpperCase()}`;
  }

  private rowToBotAllocation(r: any): BotAllocationRow {
    return {
      id: r.id,
      botId: r.bot_id,
      tradingAccountId: r.trading_account_id,
      asset: r.asset,
      allocated: r.allocated,
      free: r.free,
      used: r.used,
      realizedPnl: r.realized_pnl,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  ensureBotAllocation(input: { botId: string; tradingAccountId: string; asset: string; amount: number }): BotAllocationRow {
    const asset = input.asset.toUpperCase();
    const id = this.paperAllocationId(input.botId, input.tradingAccountId, asset);
    this.db
      .prepare(
        `INSERT INTO bot_allocations
         (id, bot_id, trading_account_id, asset, allocated, free, used, realized_pnl, status)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'active')
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, input.botId, input.tradingAccountId, asset, input.amount, input.amount);
    return this.getBotAllocation(input.botId, input.tradingAccountId, asset)!;
  }

  getBotAllocation(botId: string, tradingAccountId: string, asset: string): BotAllocationRow | null {
    const row = this.db
      .prepare("SELECT * FROM bot_allocations WHERE id = ?")
      .get(this.paperAllocationId(botId, tradingAccountId, asset)) as any | undefined;
    return row ? this.rowToBotAllocation(row) : null;
  }

  listBotAllocations(input: { tradingAccountId: string; botId?: string }): BotAllocationRow[] {
    const clauses = ["trading_account_id = ?"];
    const values: any[] = [input.tradingAccountId];
    if (input.botId) {
      clauses.push("bot_id = ?");
      values.push(input.botId);
    }
    const rows = this.db
      .prepare(`SELECT * FROM bot_allocations WHERE ${clauses.join(" AND ")} ORDER BY asset ASC`)
      .all(...values) as any[];
    return rows.map((r) => this.rowToBotAllocation(r));
  }

  updateBotAllocation(input: {
    botId: string;
    tradingAccountId: string;
    asset: string;
    freeDelta?: number;
    usedDelta?: number;
    realizedPnlDelta?: number;
  }): void {
    const asset = input.asset.toUpperCase();
    this.ensureBotAllocation({
      botId: input.botId,
      tradingAccountId: input.tradingAccountId,
      asset,
      amount: 0,
    });
    this.db
      .prepare(
        `UPDATE bot_allocations
         SET
           free = free + ?,
           used = used + ?,
           realized_pnl = realized_pnl + ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(
        input.freeDelta ?? 0,
        input.usedDelta ?? 0,
        input.realizedPnlDelta ?? 0,
        this.paperAllocationId(input.botId, input.tradingAccountId, asset),
      );
  }

  createPaperOrder(input: PaperOrderInsert): PaperOrderRow {
    this.db
      .prepare(
        `INSERT INTO paper_orders
         (id, trading_account_id, bot_id, actor_type, actor_id, agent_run_id, mandate_id, capital_allocation_id, symbol, market_type, side, position_side, order_type, amount, price, leverage, reduce_only, status, filled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tradingAccountId,
        input.botId,
        input.actorType,
        input.actorId ?? null,
        input.agentRunId ?? null,
        input.mandateId ?? null,
        input.capitalAllocationId ?? null,
        input.symbol,
        input.marketType,
        input.side,
        input.positionSide ?? null,
        input.orderType,
        input.amount,
        input.price ?? null,
        input.leverage ?? null,
        input.reduceOnly ? 1 : 0,
        input.status,
        input.filledAt ?? null,
      );
    return this.getPaperOrder(input.id)!;
  }

  getPaperOrder(id: string): PaperOrderRow | null {
    const row = this.db.prepare("SELECT * FROM paper_orders WHERE id = ?").get(id) as any | undefined;
    return row ? this.rowToPaperOrder(row) : null;
  }

  updatePaperOrder(id: string, patch: { status?: string; filledAt?: string | null; price?: number | null }): void {
    const fields: string[] = [];
    const values: any[] = [];
    if (patch.status !== undefined) {
      fields.push("status = ?");
      values.push(patch.status);
    }
    if (patch.filledAt !== undefined) {
      fields.push("filled_at = ?");
      values.push(patch.filledAt);
    }
    if (patch.price !== undefined) {
      fields.push("price = ?");
      values.push(patch.price);
    }
    if (!fields.length) return;
    values.push(id);
    this.db.prepare(`UPDATE paper_orders SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  listPaperOrders(input: { tradingAccountId: string; botId?: string; symbol?: string | null; status?: string }): PaperOrderRow[] {
    const clauses = ["trading_account_id = ?"];
    const values: any[] = [input.tradingAccountId];
    if (input.botId) {
      clauses.push("bot_id = ?");
      values.push(input.botId);
    }
    if (input.symbol) {
      clauses.push("symbol = ?");
      values.push(input.symbol);
    }
    if (input.status) {
      clauses.push("status = ?");
      values.push(input.status);
    }
    const rows = this.db
      .prepare(`SELECT * FROM paper_orders WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC, id ASC`)
      .all(...values) as any[];
    return rows.map((r) => this.rowToPaperOrder(r));
  }

  listPaperOpenOrders(input: { tradingAccountId: string; botId?: string; symbol?: string | null }): PaperOrderRow[] {
    return this.listPaperOrders({ ...input, status: "open" });
  }

  private rowToPaperOrder(r: any): PaperOrderRow {
    return {
      id: r.id,
      tradingAccountId: r.trading_account_id,
      botId: r.bot_id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      agentRunId: r.agent_run_id ?? null,
      mandateId: r.mandate_id ?? null,
      capitalAllocationId: r.capital_allocation_id ?? null,
      symbol: r.symbol,
      marketType: r.market_type,
      side: r.side,
      positionSide: r.position_side,
      orderType: r.order_type,
      amount: r.amount,
      price: r.price,
      leverage: r.leverage,
      reduceOnly: Boolean(r.reduce_only),
      status: r.status,
      createdAt: r.created_at,
      filledAt: r.filled_at,
    };
  }

  upsertPaperPosition(input: PaperPositionRow): void {
    this.db
      .prepare(
        `INSERT INTO paper_positions
         (id, trading_account_id, bot_id, symbol, market_type, position_side, amount, avg_entry_price, mark_price, leverage, margin_usdt, unrealized_pnl, realized_pnl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           amount = excluded.amount,
           avg_entry_price = excluded.avg_entry_price,
           mark_price = excluded.mark_price,
           leverage = excluded.leverage,
           margin_usdt = excluded.margin_usdt,
           unrealized_pnl = excluded.unrealized_pnl,
           realized_pnl = excluded.realized_pnl,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        input.id,
        input.tradingAccountId,
        input.botId,
        input.symbol,
        input.marketType,
        input.positionSide,
        input.amount,
        input.avgEntryPrice,
        input.markPrice,
        input.leverage,
        input.marginUsdt,
        input.unrealizedPnl,
        input.realizedPnl,
      );
  }

  deletePaperPosition(id: string): void {
    this.db.prepare("DELETE FROM paper_positions WHERE id = ?").run(id);
  }

  listPaperPositions(input: { tradingAccountId: string; botId?: string; symbol?: string | null }): PaperPositionRow[] {
    const clauses = ["trading_account_id = ?"];
    const values: any[] = [input.tradingAccountId];
    if (input.botId) {
      clauses.push("bot_id = ?");
      values.push(input.botId);
    }
    if (input.symbol) {
      clauses.push("symbol = ?");
      values.push(input.symbol);
    }
    const rows = this.db
      .prepare(`SELECT * FROM paper_positions WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC, id ASC`)
      .all(...values) as any[];
    return rows.map((r) => ({
      id: r.id,
      tradingAccountId: r.trading_account_id,
      botId: r.bot_id,
      symbol: r.symbol,
      marketType: r.market_type,
      positionSide: r.position_side,
      amount: r.amount,
      avgEntryPrice: r.avg_entry_price,
      markPrice: r.mark_price,
      leverage: r.leverage,
      marginUsdt: r.margin_usdt,
      unrealizedPnl: r.unrealized_pnl,
      realizedPnl: r.realized_pnl,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  insertPaperFill(input: PaperFillInsert): number {
    const result = this.db
      .prepare(
        `INSERT INTO paper_fills
         (order_id, trading_account_id, bot_id, actor_type, actor_id, agent_run_id, mandate_id, capital_allocation_id, symbol, market_type, side, position_side, amount, price, fee_usdt, realized_pnl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.orderId,
        input.tradingAccountId,
        input.botId,
        input.actorType,
        input.actorId ?? null,
        input.agentRunId ?? null,
        input.mandateId ?? null,
        input.capitalAllocationId ?? null,
        input.symbol,
        input.marketType,
        input.side,
        input.positionSide ?? null,
        input.amount,
        input.price,
        input.feeUsdt ?? 0,
        input.realizedPnl ?? 0,
      );
    return Number(result.lastInsertRowid);
  }

  listPaperFills(input: { orderId?: string; tradingAccountId?: string; botId?: string } = {}): PaperFillRow[] {
    const clauses: string[] = [];
    const values: any[] = [];
    if (input.orderId) {
      clauses.push("order_id = ?");
      values.push(input.orderId);
    }
    if (input.tradingAccountId) {
      clauses.push("trading_account_id = ?");
      values.push(input.tradingAccountId);
    }
    if (input.botId) {
      clauses.push("bot_id = ?");
      values.push(input.botId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM paper_fills ${where} ORDER BY id ASC`)
      .all(...values) as any[];
    return rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      tradingAccountId: r.trading_account_id,
      botId: r.bot_id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      agentRunId: r.agent_run_id ?? null,
      mandateId: r.mandate_id ?? null,
      capitalAllocationId: r.capital_allocation_id ?? null,
      symbol: r.symbol,
      marketType: r.market_type,
      side: r.side,
      positionSide: r.position_side,
      amount: r.amount,
      price: r.price,
      feeUsdt: r.fee_usdt,
      realizedPnl: r.realized_pnl,
      createdAt: r.created_at,
    }));
  }

  // --- Resident agents and strategy mandates ---

  createStrategyMandate(input: {
    id?: string;
    name: string;
    version?: number;
    status?: StrategyMandateStatus;
    description?: string;
    body?: Record<string, any>;
    validationStatus?: MandateValidationStatus;
    validationNotes?: string | null;
    createdBy?: string | null;
  }): StrategyMandateRow {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO strategy_mandates
         (id, name, version, status, description, body, validation_status, validation_notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.version ?? 1,
        input.status ?? "draft",
        input.description ?? "",
        JSON.stringify(input.body ?? {}),
        input.validationStatus ?? "deferred",
        input.validationNotes ?? null,
        input.createdBy ?? null,
      );
    return this.getStrategyMandate(id)!;
  }

  getStrategyMandate(id: string): StrategyMandateRow | null {
    const row = this.db.prepare("SELECT * FROM strategy_mandates WHERE id = ?").get(id) as any | undefined;
    return row ? this.rowToStrategyMandate(row) : null;
  }

  listStrategyMandates(input: { status?: StrategyMandateStatus } = {}): StrategyMandateRow[] {
    const rows = input.status
      ? this.db.prepare("SELECT * FROM strategy_mandates WHERE status = ? ORDER BY created_at ASC").all(input.status)
      : this.db.prepare("SELECT * FROM strategy_mandates ORDER BY created_at ASC").all();
    return (rows as any[]).map((r) => this.rowToStrategyMandate(r));
  }

  setStrategyMandateStatus(id: string, status: StrategyMandateStatus): void {
    this.db
      .prepare("UPDATE strategy_mandates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, id);
  }

  private rowToStrategyMandate(r: any): StrategyMandateRow {
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      status: r.status,
      description: r.description,
      body: this.parseJson<Record<string, any>>(r.body, {}),
      validationStatus: r.validation_status,
      validationNotes: r.validation_notes ?? null,
      createdBy: r.created_by ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createResidentAgent(input: {
    id?: string;
    type: ResidentAgentType;
    name: string;
    status?: ResidentAgentStatus;
    sessionId?: string;
    botId: string;
    tradingAccountId: string;
    capitalAllocationId?: string | null;
    scheduleExpr?: string | null;
    nextRun?: string | null;
    mandate?: string;
    toolPolicy?: string;
    riskPolicy?: Record<string, any>;
  }): ResidentAgentRow {
    const id = input.id ?? randomUUID();
    const sessionId = input.sessionId ?? `resident-agent-${id}`;
    this.createSession(sessionId, input.name, "system", input.botId);
    this.db
      .prepare(
        `INSERT INTO resident_agents
         (id, type, name, status, session_id, bot_id, trading_account_id, capital_allocation_id, schedule_expr, next_run, mandate, tool_policy, risk_policy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        input.name,
        input.status ?? "active",
        sessionId,
        input.botId,
        input.tradingAccountId,
        input.capitalAllocationId ?? null,
        input.scheduleExpr ?? null,
        input.nextRun ?? null,
        input.mandate ?? "",
        input.toolPolicy ?? `${input.type}.v1`,
        JSON.stringify(input.riskPolicy ?? {}),
      );
    return this.getResidentAgent(id)!;
  }

  getResidentAgent(id: string): ResidentAgentRow | null {
    const row = this.db.prepare("SELECT * FROM resident_agents WHERE id = ?").get(id) as any | undefined;
    return row ? this.rowToResidentAgent(row) : null;
  }

  getResidentAgentBySessionId(sessionId: string): ResidentAgentRow | null {
    const row = this.db.prepare("SELECT * FROM resident_agents WHERE session_id = ?").get(sessionId) as any | undefined;
    return row ? this.rowToResidentAgent(row) : null;
  }

  listResidentAgents(input: { status?: ResidentAgentStatus; type?: ResidentAgentType } = {}): ResidentAgentRow[] {
    const clauses: string[] = [];
    const values: any[] = [];
    if (input.status) {
      clauses.push("status = ?");
      values.push(input.status);
    }
    if (input.type) {
      clauses.push("type = ?");
      values.push(input.type);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM resident_agents ${where} ORDER BY created_at ASC`).all(...values) as any[];
    return rows.map((r) => this.rowToResidentAgent(r));
  }

  setResidentAgentStatus(id: string, status: ResidentAgentStatus): void {
    this.db
      .prepare("UPDATE resident_agents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, id);
  }

  getDueResidentAgents(now: string = new Date().toISOString()): ResidentAgentRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM resident_agents
         WHERE status = 'active' AND schedule_expr IS NOT NULL AND next_run IS NOT NULL AND next_run <= ?
         ORDER BY next_run ASC`,
      )
      .all(now) as any[];
    return rows.map((r) => this.rowToResidentAgent(r));
  }

  updateResidentAgentNextRun(id: string, nextRun: string): void {
    this.db
      .prepare("UPDATE resident_agents SET next_run = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(nextRun, id);
  }

  private rowToResidentAgent(r: any): ResidentAgentRow {
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      status: r.status,
      sessionId: r.session_id,
      botId: r.bot_id,
      tradingAccountId: r.trading_account_id,
      capitalAllocationId: r.capital_allocation_id ?? null,
      scheduleExpr: r.schedule_expr ?? null,
      nextRun: r.next_run ?? null,
      mandate: r.mandate ?? "",
      toolPolicy: r.tool_policy,
      riskPolicy: this.parseJson<Record<string, any>>(r.risk_policy, {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  assignMandateToAgent(input: {
    agentId: string;
    mandateId: string;
    universe?: string[];
    priority?: number;
    active?: boolean;
  }): AgentMandateAssignmentRow {
    const result = this.db
      .prepare(
        `INSERT INTO agent_mandate_assignments
         (agent_id, mandate_id, universe, priority, active)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.agentId,
        input.mandateId,
        JSON.stringify(input.universe ?? []),
        input.priority ?? 100,
        input.active === false ? 0 : 1,
      );
    return this.getAgentMandateAssignment(Number(result.lastInsertRowid))!;
  }

  getAgentMandateAssignment(id: number): AgentMandateAssignmentRow | null {
    const row = this.db.prepare("SELECT * FROM agent_mandate_assignments WHERE id = ?").get(id) as any | undefined;
    return row ? this.rowToAgentMandateAssignment(row) : null;
  }

  listAgentMandateAssignments(agentId: string, opts: { activeOnly?: boolean } = {}): AgentMandateAssignmentRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_mandate_assignments
         WHERE agent_id = ? ${opts.activeOnly ? "AND active = 1" : ""}
         ORDER BY priority ASC, id ASC`,
      )
      .all(agentId) as any[];
    return rows.map((r) => this.rowToAgentMandateAssignment(r));
  }

  private rowToAgentMandateAssignment(r: any): AgentMandateAssignmentRow {
    return {
      id: r.id,
      agentId: r.agent_id,
      mandateId: r.mandate_id,
      universe: this.parseJson<string[]>(r.universe, []),
      priority: r.priority,
      active: Boolean(r.active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createAgentRun(input: {
    id?: string;
    agentId: string;
    trigger: string;
    input?: string | null;
    mandateIds?: string[];
  }): AgentRunRow {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO agent_runs
         (id, agent_id, trigger, status, input, mandate_ids)
         VALUES (?, ?, ?, 'running', ?, ?)`,
      )
      .run(id, input.agentId, input.trigger, input.input ?? null, JSON.stringify(input.mandateIds ?? []));
    return this.getAgentRun(id)!;
  }

  getAgentRun(id: string): AgentRunRow | null {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as any | undefined;
    return row ? this.rowToAgentRun(row) : null;
  }

  getActiveAgentRunBySessionId(sessionId: string): AgentRunRow | null {
    const row = this.db
      .prepare(
        `SELECT ar.* FROM agent_runs ar
         JOIN resident_agents ra ON ra.id = ar.agent_id
         WHERE ra.session_id = ? AND ar.status = 'running'
         ORDER BY ar.started_at DESC LIMIT 1`,
      )
      .get(sessionId) as any | undefined;
    return row ? this.rowToAgentRun(row) : null;
  }

  finishAgentRun(id: string, patch: { status: "completed" | "failed"; summary?: string | null; error?: string | null }): void {
    this.db
      .prepare(
        `UPDATE agent_runs
         SET status = ?, summary = ?, error = ?, finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(patch.status, patch.summary ?? null, patch.error ?? null, id);
  }

  listAgentRuns(agentId: string, limit = 20): AgentRunRow[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(agentId, limit) as any[];
    return rows.map((r) => this.rowToAgentRun(r));
  }

  private rowToAgentRun(r: any): AgentRunRow {
    return {
      id: r.id,
      agentId: r.agent_id,
      trigger: r.trigger,
      status: r.status,
      input: r.input ?? null,
      summary: r.summary ?? null,
      error: r.error ?? null,
      mandateIds: this.parseJson<string[]>(r.mandate_ids, []),
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? null,
    };
  }

  logAgentEvent(input: { agentId: string; runId?: string | null; type: string; payload?: Record<string, any> | null }): number {
    const result = this.db
      .prepare("INSERT INTO agent_events (agent_id, run_id, event_type, payload) VALUES (?, ?, ?, ?)")
      .run(input.agentId, input.runId ?? null, input.type, input.payload ? JSON.stringify(input.payload) : null);
    return Number(result.lastInsertRowid);
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
