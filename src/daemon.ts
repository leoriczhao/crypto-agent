#!/usr/bin/env node
import { createInterface, type Interface as RLInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { CryptoAgent } from "./agent.js";
import { config } from "./config.js";
import { Memory } from "./memory.js";
import { HeartbeatScheduler } from "./heartbeat.js";
import { Notifier } from "./notify.js";
import { TOOL_HANDLERS } from "./tools/registry.js";
import type { SessionType } from "./session.js";
import { MarketFeed } from "./market-feed.js";
import { StrategyStore } from "./strategy/state.js";
import { SignalEngine } from "./strategy/signal-engine.js";
import { RiskGate } from "./strategy/risk-gate.js";
import { OrderExecutor } from "./strategy/executor.js";
import { TradeReviewer } from "./strategy/reviewer.js";
import { LiveExchange } from "./exchange/live.js";

// ── Markdown rendering ──────────────────────────────────────────────────────

function renderMd(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  for (const raw of lines) {
    if (raw.startsWith("```")) { inCode = !inCode; out.push(inCode ? chalk.dim("\u250c\u2500\u2500") : chalk.dim("\u2514\u2500\u2500")); continue; }
    if (inCode) { out.push(chalk.dim("\u2502 ") + chalk.gray(raw)); continue; }
    const h1 = raw.match(/^# (.+)/); if (h1) { out.push("\n" + chalk.bold.underline(fmt(h1[1])) + "\n"); continue; }
    const h2 = raw.match(/^## (.+)/); if (h2) { out.push("\n" + chalk.bold.yellow(fmt(h2[1]))); continue; }
    const h3 = raw.match(/^### (.+)/); if (h3) { out.push(chalk.bold.cyan(fmt(h3[1]))); continue; }
    if (/^---+$/.test(raw.trim())) { out.push(chalk.dim("\u2500".repeat(40))); continue; }
    out.push(fmt(raw).replace(/^(\s*)[-*] /, "$1\u2022 "));
  }
  return out.join("\n");
}
function fmt(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t)).replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, t) => chalk.italic(t)).replace(/`(.+?)`/g, (_, t) => chalk.inverse(` ${t} `));
}

// ── History ─────────────────────────────────────────────────────────────────

const HISTORY_FILE = join(homedir(), ".crypto_agent_history");

function loadHistory(): string[] {
  if (!existsSync(HISTORY_FILE)) return [];
  return readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean);
}

function saveHistoryLine(line: string): void {
  appendFileSync(HISTORY_FILE, line + "\n");
}

// ── Terminal UI (scroll region + fixed input) ───────────────────────────────

class TermUI {
  private splitRow = 0;
  private active = false;
  private ratio = 0.8; // chat area takes 80%, input area takes 20%

  setup(): void {
    const rows = stdout.rows || 24;
    this.splitRow = Math.floor(rows * this.ratio);

    stdout.write("\x1b[?1049h"); // alternate screen
    stdout.write("\x1b[2J");     // clear
    stdout.write(`\x1b[1;${this.splitRow}r`); // scroll region = chat area
    this.drawChrome();
    stdout.write(`\x1b[${rows};1H`); // cursor to absolute bottom
    this.active = true;

    stdout.on("resize", () => this.handleResize());
  }

  cleanup(): void {
    if (!this.active) return;
    stdout.write("\x1b[r");
    stdout.write("\x1b[?1049l");
    this.active = false;
  }

  print(text: string): void {
    if (!this.active) {
      console.log(text);
      return;
    }
    stdout.write("\x1b[?25l"); // hide cursor
    stdout.write("\x1b7");     // save cursor
    stdout.write(`\x1b[${this.splitRow};1H`);
    for (const line of text.split("\n")) {
      stdout.write("\n" + line);
    }
    stdout.write("\x1b8");     // restore cursor
    stdout.write("\x1b[?25h"); // show cursor
  }

  drawChrome(status?: string, hint?: string): void {
    const rows = stdout.rows || 24;
    const cols = stdout.columns || 80;

    stdout.write("\x1b[?25l");
    stdout.write("\x1b7");

    // separator line at splitRow + 1
    const sep = this.splitRow + 1;
    const bar = status ?? "";
    const barLen = stripAnsi(bar).length;
    const pad = Math.max(0, cols - barLen - 2);
    stdout.write(`\x1b[${sep};1H\x1b[2K`);
    stdout.write(chalk.dim("\u2500 ") + bar + chalk.dim(" " + "\u2500".repeat(pad)));

    // hint line at splitRow + 2
    const hintRow = sep + 1;
    if (hintRow < rows) {
      stdout.write(`\x1b[${hintRow};1H\x1b[2K`);
      stdout.write(chalk.dim(`  ${hint ?? "Tab: autocomplete | /help: commands"}`));
    }

    // clear remaining lines between hint and input row
    for (let r = hintRow + 1; r < rows; r++) {
      stdout.write(`\x1b[${r};1H\x1b[2K`);
    }

    stdout.write("\x1b8");
    stdout.write("\x1b[?25h");
  }

  private handleResize(): void {
    if (!this.active) return;
    const rows = stdout.rows || 24;
    this.splitRow = Math.floor(rows * this.ratio);
    stdout.write(`\x1b[1;${this.splitRow}r`);
    this.drawChrome();
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Daemon ──────────────────────────────────────────────────────────────────

class CryptoDaemon {
  agent: CryptoAgent;
  memory: Memory;
  notifier: Notifier;
  heartbeat: HeartbeatScheduler;
  userSessionId: string;
  systemSessionId: string;
  term: TermUI;

  // Fast path (strategy engine)
  strategyStore: StrategyStore;
  marketFeed: MarketFeed | null = null;
  signalEngine: SignalEngine | null = null;
  riskGate: RiskGate | null = null;
  executor: OrderExecutor | null = null;
  reviewer: TradeReviewer;

  private startupLog: string[] = [];

  constructor() {
    this.term = new TermUI();
    this.agent = new CryptoAgent();
    this.memory = new Memory(config.memoryDbPath);
    this.agent.memory = this.memory;

    // Strategy store (shared between LLM tools and fast path)
    this.strategyStore = new StrategyStore(this.memory);
    this.agent.strategyStore = this.strategyStore;

    this.systemSessionId = this.ensureSession("system", "system");
    this.userSessionId = this.ensureSession("user", "user");
    this.agent.sessions.setActive(this.userSessionId);

    this.notifier = new Notifier(config.notifyTelegramToken, config.notifyTelegramChatId);
    this.heartbeat = new HeartbeatScheduler(
      this.agent,
      config.heartbeatInterval,
      this.systemSessionId,
      async (msg) => { await this.onHeartbeatResponse(msg); },
    );

    this.reviewer = new TradeReviewer(this.memory, this.strategyStore);
    this.patchScheduleHandler();
    this.initFastPath();
  }

  private initFastPath(): void {
    const activeEx = this.agent.exchange;
    if (!(activeEx instanceof LiveExchange)) {
      this.startupLog.push(chalk.dim("  Fast path: skipped (paper trading uses REST)"));
      return;
    }

    try {
      this.marketFeed = new MarketFeed(activeEx.ccxtInstance);
      this.riskGate = new RiskGate(this.strategyStore, activeEx, config.initialBalance.USDT ?? 10000);
      this.signalEngine = new SignalEngine(this.marketFeed, this.strategyStore);
      this.executor = new OrderExecutor({
        exchange: activeEx,
        feed: this.marketFeed,
        riskGate: this.riskGate,
        store: this.strategyStore,
        memory: this.memory,
        paperMode: config.paperTrading,
      });

      this.signalEngine.on("signal", (signal) => {
        this.executor!.handleSignal(signal).catch((e) =>
          this.term.print(chalk.red(`[Executor error] ${e.message ?? e}`)),
        );
      });

      this.executor.on("entered", ({ signal, position }) => {
        this.term.print(chalk.green(`  [AUTO] Entered ${signal.side} ${signal.symbol} @ ${position.entryPrice} ($${signal.sizeUsdt})`));
        if (this.reviewer.recordTrade()) this.triggerReview();
      });

      this.executor.on("exited", ({ signal, pnl }) => {
        const pnlStr = pnl >= 0 ? chalk.green(`+$${pnl.toFixed(2)}`) : chalk.red(`-$${Math.abs(pnl).toFixed(2)}`);
        this.term.print(chalk.yellow(`  [AUTO] Exited ${signal.symbol} — PnL: ${pnlStr}`));
        if (this.reviewer.recordTrade()) this.triggerReview();
      });

      this.executor.on("rejected", ({ signal, reason }) => {
        this.term.print(chalk.dim(`  [RiskGate] Rejected ${signal.symbol} ${signal.action}: ${reason}`));
      });

      this.marketFeed.on("error", ({ key, error }) => {
        this.term.print(chalk.dim(`  [Feed] ${key}: ${error}`));
      });

      this.startupLog.push(chalk.dim("  Fast path: initialized (MarketFeed + SignalEngine + RiskGate + Executor)"));
    } catch (e: any) {
      this.startupLog.push(chalk.red(`  Fast path init failed: ${e.message ?? e}`));
    }
  }

  private ensureSession(name: string, type: SessionType): string {
    const existing = this.memory.getSessionByName(name);
    if (existing) {
      const session = this.agent.sessions.create(name, type, existing.id);
      const messages = this.memory.loadRecentMessages(existing.id, 20);
      if (messages.length) {
        session.messages = messages;
        this.startupLog.push(chalk.dim(`  Restored ${messages.length} messages for "${name}"`));
      }
      return existing.id;
    }
    const session = this.agent.sessions.create(name, type);
    this.memory.createSession(session.id, name, type);
    return session.id;
  }

  // ── Slash commands ──

  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(" ").trim();

    switch (cmd) {
      case "new": {
        const name = arg || `session-${Date.now()}`;
        const session = this.agent.sessions.create(name, "user");
        this.memory.createSession(session.id, name, "user");
        this.userSessionId = session.id;
        this.agent.sessions.setActive(session.id);
        this.term.print(chalk.green(`  ✓ Created session "${name}" (${session.id.slice(0, 8)}…)`));
        this.refreshBar();
        return;
      }

      case "sessions":
      case "list": {
        const sessions = this.agent.sessions.list("user");
        if (!sessions.length) {
          this.term.print(chalk.dim("  No user sessions."));
          return;
        }
        const lines = [chalk.bold("  Sessions:")];
        for (const s of sessions) {
          const active = s.id === this.userSessionId ? chalk.green(" ← active") : "";
          const msgs = chalk.dim(`${s.messages.length} msgs`);
          lines.push(`  ${chalk.cyan(s.name)} ${chalk.dim(`[${s.id.slice(0, 8)}…]`)} ${msgs}${active}`);
        }
        this.term.print(lines.join("\n"));
        return;
      }

      case "switch": {
        if (!arg) {
          this.term.print(chalk.red("  Usage: /switch <name or id>"));
          return;
        }
        const target = this.agent.sessions.getByName(arg) ?? this.findSessionByPrefix(arg);
        if (!target || target.type !== "user") {
          this.term.print(chalk.red(`  Session not found: "${arg}"`));
          return;
        }
        this.userSessionId = target.id;
        this.agent.sessions.setActive(target.id);
        this.term.print(chalk.green(`  ✓ Switched to "${target.name}" (${target.id.slice(0, 8)}…) — ${target.messages.length} msgs`));
        this.refreshBar();
        return;
      }

      case "current": {
        const s = this.agent.sessions.get(this.userSessionId);
        this.term.print([
          chalk.bold(`  Session: ${s.name}`),
          chalk.dim(`  ID:       ${s.id}`),
          chalk.dim(`  Messages: ${s.messages.length}`),
          chalk.dim(`  Created:  ${s.createdAt.toISOString()}`),
          chalk.dim(`  Active:   ${s.lastActiveAt.toISOString()}`),
        ].join("\n"));
        return;
      }

      case "compact": {
        const { autoCompact, estimateTokens } = await import("./context.js");
        const session = this.agent.sessions.get(this.userSessionId);
        const before = estimateTokens(session.messages);
        this.term.print(chalk.dim("  Compacting..."));
        await this.agent.initClient();
        session.messages = await autoCompact(
          session.messages, this.agent.client, this.agent.provider,
          null, { force: true, sessionId: this.userSessionId },
        );
        const after = estimateTokens(session.messages);
        this.term.print(chalk.green(`  ✓ Compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens`));
        return;
      }

      case "trades": {
        const limit = parseInt(arg, 10) || 10;
        const trades = this.memory.getRecentTrades(limit);
        if (!trades.length) {
          this.term.print(chalk.dim("  No trades recorded."));
          return;
        }
        const lines = [chalk.bold("  Recent Trades:")];
        for (const t of trades) {
          const side = t.side === "buy" ? chalk.green("BUY ") : chalk.red("SELL");
          const ts = t.created_at.slice(0, 16).replace("T", " ");
          lines.push(`  ${chalk.dim(ts)} ${side} ${chalk.white(t.amount)} ${chalk.cyan(t.symbol)} @ ${chalk.yellow(t.price)} ${chalk.dim(`[${t.mode}]`)}`);
        }
        this.term.print(lines.join("\n"));
        return;
      }

      case "delete": {
        if (!arg) {
          this.term.print(chalk.red("  Usage: /delete <name or id>"));
          return;
        }
        const dt = this.agent.sessions.getByName(arg) ?? this.findSessionByPrefix(arg);
        if (!dt || dt.type !== "user") {
          this.term.print(chalk.red(`  Session not found: "${arg}"`));
          return;
        }
        if (dt.id === this.userSessionId) {
          this.term.print(chalk.red("  Cannot delete the active session. /switch first."));
          return;
        }
        this.agent.sessions.delete(dt.id);
        this.memory.deleteSession(dt.id);
        this.term.print(chalk.green(`  ✓ Deleted session "${dt.name}"`));
        return;
      }

      case "rules": {
        const rules = this.strategyStore.getAllRules();
        if (!rules.length) {
          this.term.print(chalk.dim("  No strategy rules. Use LLM to create one (plan_strategy tool)."));
          return;
        }
        const lines = [chalk.bold("  Strategy Rules:")];
        for (const r of rules) {
          const st = r.enabled ? chalk.green("ON ") : chalk.red("OFF");
          lines.push(`  ${st} ${r.id.slice(0, 8)}… ${chalk.cyan(r.symbol)} ${r.side} $${r.positionSizeUsdt} SL:${r.stopLossPct}% TP:${r.takeProfitPct}%`);
        }
        this.term.print(lines.join("\n"));
        return;
      }

      case "risk": {
        const rp = this.strategyStore.riskParams;
        this.term.print([
          chalk.bold("  Risk Parameters:"),
          chalk.dim(`  Max Position:    ${rp.maxPositionPct}%`),
          chalk.dim(`  Max Exposure:    ${rp.maxExposurePct}%`),
          chalk.dim(`  Max Drawdown:    ${rp.maxDrawdownPct}%`),
          chalk.dim(`  Max Daily Loss:  ${rp.maxDailyLossPct}%`),
          chalk.dim(`  Max Positions:   ${rp.maxConcurrentPositions}`),
        ].join("\n"));
        return;
      }

      case "engine": {
        const feed = this.marketFeed ? `${this.marketFeed.activeSubscriptions.length} subscriptions` : "off";
        const positions = this.executor?.activePositions.length ?? 0;
        const rulesCount = this.strategyStore.getActiveRules().length;
        this.term.print([
          chalk.bold("  Execution Engine:"),
          chalk.dim(`  MarketFeed:     ${feed}`),
          chalk.dim(`  Active Rules:   ${rulesCount}`),
          chalk.dim(`  Open Positions: ${positions}`),
          chalk.dim(`  Signal Engine:  ${this.signalEngine ? "running" : "off"}`),
        ].join("\n"));
        return;
      }

      case "help": {
        this.term.print([
          chalk.bold("  Commands:"),
          `  ${chalk.cyan("/new [name]")}       Create a new session`,
          `  ${chalk.cyan("/sessions")}         List sessions`,
          `  ${chalk.cyan("/switch <name>")}    Switch session`,
          `  ${chalk.cyan("/current")}          Current session info`,
          `  ${chalk.cyan("/compact")}          Compact context`,
          `  ${chalk.cyan("/trades [n]")}       Recent trades`,
          `  ${chalk.cyan("/delete <name>")}    Delete session`,
          `  ${chalk.cyan("/rules")}            Strategy rules`,
          `  ${chalk.cyan("/risk")}             Risk parameters`,
          `  ${chalk.cyan("/engine")}           Execution engine status`,
          `  ${chalk.cyan("/help")}             This help`,
        ].join("\n"));
        return;
      }

      default:
        this.term.print(chalk.red(`  Unknown command: /${cmd}. Type /help for available commands.`));
    }
  }

  private completeSlashCommand(line: string): [string[], string] {
    const COMMANDS = ["/new", "/sessions", "/switch", "/current", "/compact", "/trades", "/delete", "/rules", "/risk", "/engine", "/help"];

    if (!line.startsWith("/")) return [[], line];

    const parts = line.split(/\s+/);
    if (parts.length === 1) {
      const hits = COMMANDS.filter((c) => c.startsWith(parts[0]));
      return [hits.length ? hits : COMMANDS, line];
    }

    const cmd = parts[0].toLowerCase();
    if (cmd === "/switch" || cmd === "/delete") {
      const partial = parts[1] ?? "";
      const names = this.agent.sessions
        .list("user")
        .map((s) => s.name)
        .filter((n) => n.startsWith(partial));
      const completions = names.map((n) => `${cmd} ${n}`);
      return [completions, line];
    }

    return [[], line];
  }

  private findSessionByPrefix(prefix: string) {
    for (const s of this.agent.sessions.list("user")) {
      if (s.id.startsWith(prefix) || s.name === prefix) return s;
    }
    return undefined;
  }

  private refreshBar(): void {
    const session = this.agent.sessions.get(this.userSessionId);
    const mode = config.paperTrading ? chalk.green("PAPER") : chalk.red("LIVE");
    const rulesCount = this.strategyStore.getActiveRules().length;
    const posCount = this.executor?.activePositions.length ?? 0;
    const engineTag = this.signalEngine ? chalk.dim(`${rulesCount}R ${posCount}P`) : chalk.dim("engine off");
    const status = `${mode} ${chalk.dim("|")} ${chalk.cyan(config.defaultExchange)} ${chalk.dim("|")} ${chalk.yellow(session.name)} ${chalk.dim(`[${session.messages.length}]`)} ${chalk.dim("|")} ${engineTag}`;
    this.term.drawChrome(status);
  }

  private startFastPath(): void {
    if (!this.signalEngine || !this.executor) return;
    const rules = this.strategyStore.getActiveRules();
    const symbols = [...new Set(rules.map((r) => r.symbol))];
    if (symbols.length === 0) {
      this.term.print(chalk.dim("  Fast path: no active rules, engine idle. Use LLM to create rules."));
      return;
    }
    this.signalEngine.start(symbols);
    this.executor.start(symbols);
    this.term.print(chalk.dim(`  Fast path: watching ${symbols.join(", ")}`));

    for (const sym of symbols) {
      this.agent.exchange.fetchOhlcv(sym, "1m", 100).then((candles: any[]) => {
        const closes = candles.map((c: any) => c.close as number);
        this.signalEngine!.seedHistory(sym, closes);
      }).catch(() => {});
    }
  }

  private triggerReview(): void {
    const prompt = this.reviewer.buildReviewPrompt();
    this.agent.chatInSession(this.systemSessionId, `[REVIEW]\n${prompt}`).then((response) => {
      this.reviewer.saveReviewResult(this.systemSessionId, response);
      this.term.print(chalk.dim(`[Review] ${response.slice(0, 150)}…`));
    }).catch((e) => {
      this.term.print(chalk.dim(`[Review error] ${e.message ?? e}`));
    });
  }

  // ── Internal plumbing ──

  private patchScheduleHandler(): void {
    const original = TOOL_HANDLERS.schedule;
    if (original) {
      const memory = this.memory;
      TOOL_HANDLERS.schedule = async (args) => original({ memory, ...args });
    }
  }

  private async onHeartbeatResponse(response: string): Promise<void> {
    if (!response.toLowerCase().includes("all clear")) {
      this.term.print(chalk.dim(`[Heartbeat] ${response.slice(0, 200)}`));
      if (this.notifier.enabled) await this.notifier.send(response);
    }
  }

  private async checkCronJobs(): Promise<void> {
    while (true) {
      await new Promise((r) => setTimeout(r, 30_000));
      const dueJobs = this.memory.getDueCronJobs();
      for (const job of dueJobs) {
        try {
          const response = await this.agent.chatInSession(
            this.systemSessionId,
            `[CRON] Execute scheduled task: ${job.description}`,
          );
          this.memory.saveMessage(this.systemSessionId, "user", `[CRON] ${job.description}`);
          this.memory.saveMessage(this.systemSessionId, "assistant", response);
          this.term.print(chalk.dim(`[Cron #${job.id}] ${response.slice(0, 200)}`));
          const interval = parseInt(job.cron_expr.replace("every_", "").replace("m", ""), 10);
          const nextRun = new Date(Date.now() + interval * 60_000).toISOString();
          this.memory.updateCronNextRun(job.id, nextRun);
        } catch (e: any) {
          this.term.print(chalk.red(`[Cron error] ${e.message ?? e}`));
        }
      }
    }
  }

  // ── Main run loop ──

  async run(): Promise<void> {
    this.term.setup();

    const mode = config.paperTrading ? chalk.green("PAPER") : chalk.red("LIVE");
    const soulName = this.agent.soul.name;
    this.term.print(
      `${chalk.cyan.bold("Crypto Agent Daemon")} ${chalk.dim(`(${mode} | ${config.defaultExchange} | ${soulName} | heartbeat: ${config.heartbeatInterval}s)`)}`,
    );
    this.term.print(chalk.dim(`Sessions: user=${this.userSessionId.slice(0, 8)}… system=${this.systemSessionId.slice(0, 8)}…`));
    if (this.notifier.enabled) this.term.print(chalk.dim("Telegram notifications: enabled"));
    for (const msg of this.startupLog) this.term.print(msg);
    this.term.print(chalk.dim("Tab: autocomplete | Ctrl+D: quit | /help: commands\n"));

    this.refreshBar();

    const rl = createInterface({
      input: stdin,
      output: stdout,
      completer: (line: string) => this.completeSlashCommand(line),
      terminal: true,
      history: loadHistory(),
    } as any);

    const question = (prompt: string): Promise<string> =>
      new Promise((resolve, reject) => {
        rl.question(prompt, resolve);
        rl.once("close", () => reject(new Error("closed")));
      });

    await this.heartbeat.start();
    this.checkCronJobs();
    this.startFastPath();

    const sessionName = () => this.agent.sessions.get(this.userSessionId).name;

    try {
      while (true) {
        let query: string;
        try {
          query = await question(`${chalk.dim(sessionName())} >> `);
        } catch {
          break;
        }

        query = query.trim();
        if (!query) continue;
        if (["q", "exit", "quit"].includes(query.toLowerCase())) break;
        saveHistoryLine(query);

        if (query.startsWith("/")) {
          await this.handleSlashCommand(query);
          continue;
        }

        this.memory.saveMessage(this.userSessionId, "user", query);
        this.term.print(chalk.dim("  Thinking..."));
        const response = await this.agent.chatInSession(this.userSessionId, query);
        this.memory.saveMessage(this.userSessionId, "assistant", response);
        this.term.print(renderMd(response));
        this.refreshBar();
      }
    } finally {
      rl.close();
      this.signalEngine?.stop();
      await this.marketFeed?.close();
      await this.heartbeat.stop();
      await this.agent.close();
      this.memory.close();
      this.term.cleanup();
    }
  }
}

export function runDaemon(): void {
  new CryptoDaemon().run().catch((e) => {
    stdout.write("\x1b[r\x1b[?1049l");
    console.error(e);
  });
}

runDaemon();
