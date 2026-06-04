#!/usr/bin/env node
import { CryptoAgent } from "./agent.js";
import { config } from "./config.js";
import { Memory } from "./memory.js";
import { HeartbeatScheduler } from "./heartbeat.js";
import { Notifier } from "./notify.js";
import { TOOL_HANDLERS } from "./tools/registry.js";
import type { SessionType } from "./session.js";
import { MarketFeed } from "./market-feed.js";
import { StrategyManager } from "./strategy/manager.js";
import { StrategyRuntime } from "./strategy/runtime.js";
import { SignalStrategy } from "./strategy/signal-strategy.js";
import { RiskGate } from "./strategy/risk-gate.js";
import { OrderExecutor } from "./strategy/executor.js";
import { TradeReviewer } from "./strategy/reviewer.js";
import { buildWorldSnapshot } from "./world-snapshot.js";
import { IpcServer } from "./ipc/server.js";
import { acquireDaemonLock, releaseDaemonLock, DaemonAlreadyRunningError } from "./ipc/lockfile.js";
import { socketPath } from "./ipc/paths.js";

/**
 * Headless crypto trading daemon. Runs all stateful components (agent,
 * strategy engine, heartbeat, cron, sessions) and exposes a Unix-socket IPC
 * endpoint for CLI clients to attach to.
 *
 * No embedded REPL — use the `crypto-agent` CLI to interact.
 */
class CryptoDaemon {
  private agent: CryptoAgent;
  private memory: Memory;
  private notifier: Notifier;
  private heartbeat: HeartbeatScheduler;
  private userSessionId: string;
  private systemSessionId: string;
  private ipc: IpcServer;

  // Fast path
  private strategyStore: StrategyManager;
  private marketFeed: MarketFeed | null = null;
  private runtime: StrategyRuntime | null = null;
  private riskGate: RiskGate | null = null;
  private executor: OrderExecutor | null = null;
  private reviewer: TradeReviewer;

  private shuttingDown = false;

  constructor() {
    this.agent = new CryptoAgent();
    this.memory = new Memory(config.memoryDbPath);
    this.agent.memory = this.memory;

    this.strategyStore = new StrategyManager(this.memory);
    this.agent.strategyStore = this.strategyStore;

    // Restore user-driven soul / exchange choices before any fast-path setup
    this.restoreDaemonState();

    this.systemSessionId = this.ensureSession("system", "system");
    this.userSessionId = this.ensureSession("user", "user");
    const savedActiveSession = this.memory.getDaemonState("active_user_session_id");
    if (savedActiveSession && this.agent.sessions.has(savedActiveSession)) {
      this.userSessionId = savedActiveSession;
    }
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

    // IPC server last — needs the other pieces to route requests
    this.ipc = new IpcServer({
      onChat: (session, content, requestId, onDelta, onToolUse, signal) =>
        this.handleChat(session, content, onDelta, onToolUse, signal),
      onSlash: (command) => this.handleSlashCommand(command),
      onListSessions: () => this.listSessionsForClient(),
      onStatus: () => this.buildStatus(),
      describe: () => ({
        mode: config.paperTrading ? "PAPER" : "LIVE",
        exchange: this.agent.exchangeManager.activeId || config.defaultExchange,
        soul: this.agent.soul.name,
        heartbeatInterval: config.heartbeatInterval,
        fastPath: this.currentFastPathState(),
      }),
    });
  }

  private restoreDaemonState(): void {
    const savedSoul = this.memory.getDaemonState("active_soul");
    if (savedSoul) {
      try {
        this.agent.soul.switch(savedSoul);
        this.log(`Restored soul: ${savedSoul}`);
      } catch (e: any) {
        this.log(`Could not restore soul "${savedSoul}": ${e.message ?? e}`);
      }
    }
    const savedExchange = this.memory.getDaemonState("active_exchange");
    if (savedExchange) {
      try {
        this.agent.exchangeManager.setActive(savedExchange);
        this.log(`Restored active exchange: ${savedExchange}`);
      } catch (e: any) {
        this.log(`Could not restore exchange "${savedExchange}": ${e.message ?? e}`);
      }
    }
  }

  private initFastPath(): void {
    const activeEx = this.agent.exchange as any;
    const ccxt = activeEx?.ccxtInstance;
    if (!ccxt) {
      this.log(`Fast path: skipped (active exchange exposes no ccxt instance)`);
      return;
    }

    try {
      this.marketFeed = new MarketFeed(ccxt);
      this.riskGate = new RiskGate(this.strategyStore, activeEx, config.initialBalance.USDT ?? 10000, this.memory);
      this.runtime = new StrategyRuntime({
        feed: this.marketFeed,
        manager: this.strategyStore,
        memory: this.memory,
        exchange: activeEx,
      });
      this.executor = new OrderExecutor({
        exchange: activeEx,
        feed: this.marketFeed,
        riskGate: this.riskGate,
        store: this.strategyStore,
        memory: this.memory,
        paperMode: config.paperTrading,
      });

      this.runtime.on("signal", (signal) => {
        this.executor!.handleSignal(signal).catch((e) =>
          this.log(`[Executor error] ${e.message ?? e}`),
        );
      });

      // Let the runtime forward executor fills/exits back to owning strategies
      // — ladder/grid need to react to combined state changes.
      this.runtime.wireExecutor(this.executor);

      this.runtime.on("strategy_error", ({ strategyId, error }) => {
        this.log(`[Strategy error] ${strategyId.slice(0, 8)}: ${error}`);
      });

      this.executor.on("entered", ({ signal, position }) => {
        this.ipc.broadcast({
          type: "event",
          kind: "trade_entered",
          data: { symbol: signal.symbol, side: signal.side, entryPrice: position.entryPrice, sizeUsdt: signal.sizeUsdt },
          timestamp: Date.now(),
        });
        if (this.reviewer.recordTrade()) this.triggerReview();
      });

      this.executor.on("exited", ({ signal, pnl }) => {
        this.ipc.broadcast({
          type: "event",
          kind: "trade_exited",
          data: { symbol: signal.symbol, pnl },
          timestamp: Date.now(),
        });
        if (this.reviewer.recordTrade()) this.triggerReview();
      });

      this.executor.on("rejected", ({ signal, reason }) => {
        this.ipc.broadcast({
          type: "event",
          kind: "trade_rejected",
          data: { symbol: signal.symbol, action: signal.action, reason },
          timestamp: Date.now(),
        });
      });

      this.marketFeed.on("error", ({ key, error }) => {
        this.ipc.broadcast({
          type: "event",
          kind: "feed_error",
          data: { key, error },
          timestamp: Date.now(),
        });
      });

      // Drive Paper-mode limit-order matching off the MarketFeed tick stream.
      // Every ticker update → check if any open limit orders on that symbol
      // cross their trigger price; fill them in-memory. Live mode runs its
      // own order lifecycle (REST polling TBD).
      if (typeof (activeEx as any).processTick === "function") {
        this.marketFeed.on("tick", (tick) => {
          try {
            (activeEx as any).processTick(tick.symbol, tick.last);
          } catch (e: any) {
            this.log(`[Paper processTick error] ${e.message ?? e}`);
          }
        });
      }

      // Paper exchange emits orderFilled when a limit order crosses — route it
      // to the executor so the async fill becomes a real position + event.
      if (typeof (activeEx as any).on === "function") {
        (activeEx as any).on("orderFilled", (order: any) => {
          this.executor
            ?.onExchangeFill(order.id, order.price)
            .catch((e: any) => this.log(`[Limit fill error] ${e.message ?? e}`));
        });
        (activeEx as any).on("orderCancelled", (order: any) => {
          // Roll the pending_orders row forward so we don't try to resume it.
          try {
            const pending = this.memory.getPendingOrderByExchangeId(order.id);
            if (pending) this.memory.updatePendingOrder(pending.id, { status: "cancelled" });
          } catch {}
        });
      }

      // Newly created strategies get started + seeded on the fly, no restart.
      this.strategyStore.on("strategyAdded", (strat) => {
        if (!this.runtime || !this.executor) return;
        this.runtime.startOne(strat);
        this.executor.start([strat.symbol]);
        this.log(`Fast path: now running strategy ${strat.id.slice(0, 8)} [${strat.kind}] on ${strat.symbol}`);
        this.seedStrategy(strat).catch((e: any) => {
          this.log(`[Seed error] ${strat.symbol} strategy ${strat.id.slice(0, 8)}: ${e.message ?? e}`);
        });
      });

      this.strategyStore.on("strategyRemoved", (id) => {
        this.runtime?.stopOne(id).catch((e: any) => this.log(`[Stop error] ${id.slice(0, 8)}: ${e.message ?? e}`));
        this.log(`Fast path: stopped strategy ${id.slice(0, 8)}`);
      });

      this.log(`Fast path: initialized (MarketFeed + Runtime + RiskGate + Executor)`);
    } catch (e: any) {
      this.log(`Fast path init failed: ${e.message ?? e}`);
    }
  }

  private ensureSession(name: string, type: SessionType): string {
    const existing = this.memory.getSessionByName(name);
    if (existing) {
      const session = this.agent.sessions.create(name, type, existing.id);
      const messages = this.memory.loadRecentMessages(existing.id, 20);
      if (messages.length) {
        session.messages = messages;
        this.log(`Restored ${messages.length} messages for "${name}"`);
      }
      return existing.id;
    }
    const session = this.agent.sessions.create(name, type);
    this.memory.createSession(session.id, name, type);
    return session.id;
  }

  // ─── IPC request handlers ─────────────────────────────────────────────────

  private async handleChat(
    session: string,
    content: string,
    onDelta: (text: string) => void,
    onToolUse: (name: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const sessionId = this.resolveSessionId(session);
    this.memory.saveMessage(sessionId, "user", content);
    const response = await this.agent.chatInSession(sessionId, content, { onDelta, onToolUse, signal });
    this.memory.saveMessage(sessionId, "assistant", response);
    return response;
  }

  private resolveSessionId(sessionNameOrId: string): string {
    // Try name lookup first (most CLIs send a friendly name like "user")
    const byName = this.agent.sessions.getByName(sessionNameOrId);
    if (byName) return byName.id;
    // Fallback: treat as id
    if (this.agent.sessions.has(sessionNameOrId)) return sessionNameOrId;
    throw new Error(`Unknown session: ${sessionNameOrId}`);
  }

  private async handleSlashCommand(input: string): Promise<{ text: string; activeSessionChanged?: string }> {
    const parts = input.replace(/^\//, "").split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(" ").trim();

    switch (cmd) {
      case "new": {
        const name = arg || `session-${Date.now()}`;
        const session = this.agent.sessions.create(name, "user");
        this.memory.createSession(session.id, name, "user");
        this.userSessionId = session.id;
        this.agent.sessions.setActive(session.id);
        this.memory.setDaemonState("active_user_session_id", session.id);
        return { text: `✓ Created session "${name}" (${session.id.slice(0, 8)}…)`, activeSessionChanged: name };
      }

      case "sessions":
      case "list": {
        const sessions = this.agent.sessions.list("user");
        if (!sessions.length) return { text: "(no user sessions)" };
        const lines = ["Sessions:"];
        for (const s of sessions) {
          const active = s.id === this.userSessionId ? " ← active" : "";
          lines.push(`  ${s.name} [${s.id.slice(0, 8)}…] ${s.messages.length} msgs${active}`);
        }
        return { text: lines.join("\n") };
      }

      case "switch": {
        if (!arg) return { text: "Usage: /switch <name or id>" };
        const target = this.agent.sessions.getByName(arg) ?? this.findSessionByPrefix(arg);
        if (!target || target.type !== "user") return { text: `Session not found: "${arg}"` };
        this.userSessionId = target.id;
        this.agent.sessions.setActive(target.id);
        this.memory.setDaemonState("active_user_session_id", target.id);
        return {
          text: `✓ Switched to "${target.name}" (${target.id.slice(0, 8)}…) — ${target.messages.length} msgs`,
          activeSessionChanged: target.name,
        };
      }

      case "current": {
        const s = this.agent.sessions.get(this.userSessionId);
        return {
          text: [
            `Session: ${s.name}`,
            `ID:       ${s.id}`,
            `Messages: ${s.messages.length}`,
            `Created:  ${s.createdAt.toISOString()}`,
            `Active:   ${s.lastActiveAt.toISOString()}`,
          ].join("\n"),
        };
      }

      case "compact": {
        const { autoCompact, estimateTokens } = await import("./context.js");
        const session = this.agent.sessions.get(this.userSessionId);
        const before = estimateTokens(session.messages);
        await this.agent.initClient();
        session.messages = await autoCompact(
          session.messages,
          this.agent.client,
          this.agent.provider,
          null,
          { force: true, sessionId: this.userSessionId },
        );
        const after = estimateTokens(session.messages);
        return { text: `✓ Compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens` };
      }

      case "trades": {
        const limit = parseInt(arg, 10) || 10;
        const trades = this.memory.getRecentTrades(limit);
        if (!trades.length) return { text: "(no trades recorded)" };
        const lines = ["Recent Trades:"];
        for (const t of trades) {
          const ts = t.created_at.slice(0, 16).replace("T", " ");
          lines.push(`  ${ts} ${t.side.toUpperCase().padEnd(4)} ${t.amount} ${t.symbol} @ ${t.price} [${t.mode}]`);
        }
        return { text: lines.join("\n") };
      }

      case "delete": {
        if (!arg) return { text: "Usage: /delete <name or id>" };
        const dt = this.agent.sessions.getByName(arg) ?? this.findSessionByPrefix(arg);
        if (!dt || dt.type !== "user") return { text: `Session not found: "${arg}"` };
        if (dt.id === this.userSessionId) return { text: "Cannot delete the active session. /switch first." };
        this.agent.sessions.delete(dt.id);
        this.memory.deleteSession(dt.id);
        // Clean stored pointer if it happened to reference the deleted one
        if (this.memory.getDaemonState("active_user_session_id") === dt.id) {
          this.memory.deleteDaemonState("active_user_session_id");
        }
        return { text: `✓ Deleted session "${dt.name}"` };
      }

      case "rules":
      case "strategies": {
        const strats = this.strategyStore.getAllStrategies();
        if (!strats.length) return { text: "(no strategies — use plan_strategy to create one)" };
        const lines = ["Strategies:"];
        for (const s of strats) {
          const st = s.enabled ? "ON " : "OFF";
          const p = s.params as Record<string, any>;
          const side = p.side ?? "?";
          const sl = p.stopLossPct != null ? `SL:${p.stopLossPct}%` : "SL:—";
          const tp = p.takeProfitPct != null ? `TP:${p.takeProfitPct}%` : "TP:—";
          let detail: string;
          if (s.kind === "signal") {
            detail = `@${p.timeframe ?? "?"} ${side} $${p.positionSizeUsdt ?? 0}`;
          } else if (s.kind === "ladder") {
            const totalSize = (p.levels ?? []).reduce((a: number, l: any) => a + Number(l.sizeUsdt || 0), 0);
            detail = `${side} ${p.levels?.length ?? 0}levels total $${totalSize}`;
          } else {
            detail = side;
          }
          lines.push(`  ${st} ${s.id.slice(0, 8)}… [${s.kind}] ${s.symbol} ${detail} ${sl} ${tp}`);
        }
        return { text: lines.join("\n") };
      }

      case "risk": {
        const rp = this.strategyStore.riskParams;
        return {
          text: [
            "Risk Parameters:",
            `  Max Position:    ${rp.maxPositionPct}%`,
            `  Max Exposure:    ${rp.maxExposurePct}%`,
            `  Max Drawdown:    ${rp.maxDrawdownPct}%`,
            `  Max Daily Loss:  ${rp.maxDailyLossPct}%`,
            `  Max Positions:   ${rp.maxConcurrentPositions}`,
          ].join("\n"),
        };
      }

      case "budget":
      case "account": {
        const budgets = this.strategyStore.listBudgets();
        let accountTotal = 0;
        try {
          const balance = await this.agent.exchange.fetchBalance();
          const positions = await this.agent.exchange.fetchPositions();
          const usdtFree = balance.USDT?.total ?? balance.USDT?.free ?? 0;
          let exposure = 0;
          for (const pos of Object.values(positions) as any[]) {
            exposure += Math.abs((pos.amount ?? 0) * (pos.current_price ?? pos.avg_entry_price ?? 0));
          }
          accountTotal = usdtFree + exposure;
        } catch {}
        const allocatedSum = budgets.reduce((a, b) => a + b.allocatedUsdt, 0);
        const usedSum = budgets.reduce((a, b) => a + b.usedUsdt, 0);
        const lines = [
          "Account Budget:",
          `  Total Portfolio:     $${accountTotal.toFixed(2)}`,
          `  Allocated to rules:  $${allocatedSum.toFixed(2)}`,
          `  Unallocated:         $${Math.max(0, accountTotal - allocatedSum).toFixed(2)}`,
          "",
          `Strategies (${budgets.length}):`,
        ];
        if (!budgets.length) lines.push("  (none)");
        for (const b of budgets) {
          const strat = this.strategyStore.getStrategy(b.id)!;
          const used = b.usedUsdt.toFixed(2);
          const pnl = b.realizedPnl >= 0 ? `+$${b.realizedPnl.toFixed(2)}` : `-$${Math.abs(b.realizedPnl).toFixed(2)}`;
          lines.push(
            `  ${b.id.slice(0, 8)}… ${strat.symbol} [${strat.kind}]  alloc $${b.allocatedUsdt.toFixed(2)}  used $${used}  pnl ${pnl}  open ${b.openPositions}`,
          );
        }
        return { text: lines.join("\n") };
      }

      case "engine": {
        const feed = this.marketFeed ? `${this.marketFeed.activeSubscriptions.length} subscriptions` : "off";
        const positions = this.executor?.activePositions.length ?? 0;
        const active = this.strategyStore.getActiveStrategies().length;
        return {
          text: [
            "Execution Engine:",
            `  MarketFeed:         ${feed}`,
            `  Active Strategies:  ${active}`,
            `  Open Positions:     ${positions}`,
            `  Runtime:            ${this.runtime ? "running" : "off"}`,
          ].join("\n"),
        };
      }

      case "research": {
        if (!arg) {
          return {
            text:
              "Usage: /research <hypothesis or area>\n" +
              "Example: /research BTC 4h SMA20/50 golden cross in current regime",
          };
        }
        try {
          await this.agent.initClient();
          const { runSubAgent } = await import("./sub-agents.js");
          const report = await runSubAgent(this.agent, this.userSessionId, "strategist", arg);
          this.ipc.broadcast({
            type: "event",
            kind: "strategist_report",
            data: { task: arg, report },
            timestamp: Date.now(),
          });
          return { text: `[STRATEGIST]\n${report}` };
        } catch (e: any) {
          return { text: `Research error: ${e.message ?? e}` };
        }
      }

      case "kb": {
        const entries = this.memory.searchResearchKb({ query: arg || undefined, limit: 20 });
        if (!entries.length) return { text: "(KB empty — run /research to populate it)" };
        const lines = ["Research KB:"];
        for (const e of entries) {
          const sym = e.symbol ? ` [${e.symbol}${e.timeframe ? `/${e.timeframe}` : ""}]` : "";
          const rule = e.ruleId ? ` → rule ${e.ruleId.slice(0, 8)}…` : "";
          const why = e.failureReason ? ` — ${e.failureReason}` : "";
          lines.push(`  #${e.id}${sym} [${e.outcome}] ${e.hypothesis}${rule}${why}`);
        }
        return { text: lines.join("\n") };
      }

      case "help":
        return {
          text: [
            "Commands:",
            "  /new [name]       Create a new session",
            "  /sessions         List sessions",
            "  /switch <name>    Switch session",
            "  /current          Current session info",
            "  /compact          Compact context",
            "  /trades [n]       Recent trades",
            "  /delete <name>    Delete session",
            "  /strategies       List strategies (alias: /rules)",
            "  /budget           Account + per-strategy budget (alias: /account)",
            "  /risk             Risk parameters",
            "  /engine           Execution engine status",
            "  /research <task>  Run strategist research loop",
            "  /kb [query]       Browse strategy research KB",
            "  /help             This help",
          ].join("\n"),
        };

      default:
        return { text: `Unknown command: /${cmd}. Type /help for available commands.` };
    }
  }

  private findSessionByPrefix(prefix: string) {
    for (const s of this.agent.sessions.list("user")) {
      if (s.id.startsWith(prefix) || s.name === prefix) return s;
    }
    return undefined;
  }

  private listSessionsForClient() {
    const sessions = this.agent.sessions.list("user").map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      messageCount: s.messages.length,
      lastActiveAt: s.lastActiveAt.toISOString(),
    }));
    return { sessions, activeId: this.userSessionId };
  }

  private async buildStatus() {
    let snapshot = "(snapshot unavailable)";
    try {
      snapshot = await buildWorldSnapshot(this.agent.exchange, {
        paperTrading: config.paperTrading,
        strategyStore: this.strategyStore,
      });
    } catch {}
    return {
      activeRules: this.strategyStore.getActiveStrategies().length,
      openPositions: this.executor?.activePositions.length ?? 0,
      fastPath: this.currentFastPathState(),
      snapshot,
    };
  }

  private currentFastPathState(): "running" | "idle" | "off" {
    if (!this.runtime) return "off";
    const active = this.strategyStore.getActiveStrategies().length;
    return active > 0 ? "running" : "idle";
  }

  private async reconcilePendingOrders(): Promise<void> {
    const pending = this.memory.loadOpenPendingOrders();
    if (!pending.length) return;

    let openOrders: any[] = [];
    try {
      openOrders = await this.agent.exchange.fetchOpenOrders();
    } catch (err: any) {
      this.log(`Pending-order reconciliation skipped (fetchOpenOrders failed): ${err.message ?? err}`);
      return;
    }

    const openById = new Map<string, any>();
    for (const o of openOrders) {
      if (o?.id) openById.set(String(o.id), o);
    }

    let filledCount = 0;
    let stillOpen = 0;
    let unknown = 0;
    for (const p of pending) {
      if (!p.exchangeOrderId) {
        // Never got an exchange id — we don't know what happened
        this.memory.updatePendingOrder(p.id, { status: "unknown" });
        unknown++;
        continue;
      }
      if (openById.has(String(p.exchangeOrderId))) {
        stillOpen++;
      } else {
        // Not in open-orders list → either filled or cancelled. Treat as filled
        // (conservative; audit via trades table).
        this.memory.updatePendingOrder(p.id, { status: "filled" });
        filledCount++;
      }
    }
    this.log(
      `Pending-order reconciliation: ${stillOpen} still open, ${filledCount} filled while offline, ${unknown} unknown`,
    );
  }

  private async startFastPath(): Promise<void> {
    if (!this.runtime || !this.executor) return;

    // Restore tracked positions before listening to ticks, so stop-loss logic
    // is armed from the first incoming price update.
    try {
      const summary = await this.executor.restore();
      if (summary.restored.length) {
        this.log(`Fast path: restored ${summary.restored.length} position(s) from persistence`);
      }
      if (summary.staleDropped.length) {
        this.log(`Fast path: dropped ${summary.staleDropped.length} stale position record(s)`);
      }
      for (const orphan of summary.orphans) {
        this.log(`⚠️  Orphan position on exchange (not tracked locally): ${orphan.key} ≈ $${orphan.value.toFixed(2)}`);
      }
    } catch (e: any) {
      this.log(`Fast path: restore error — ${e.message ?? e}`);
    }

    // Reconcile pending orders: anything still 'open' locally gets cross-checked
    // against the exchange's open-orders list so we know whether it filled while
    // the daemon was down.
    await this.reconcilePendingOrders();

    const strategies = this.strategyStore.getActiveStrategies();
    const symbols = [...new Set([
      ...strategies.map((s) => s.symbol),
      ...this.executor.activePositions.map((p) => p.symbol), // also watch restored positions
    ])];
    if (strategies.length === 0) {
      this.log("Fast path: no active strategies, engine idle");
      return;
    }
    this.runtime.startAll();
    this.executor.start(symbols);
    const subs = strategies.map((s) => {
      const tf = (s.params as any).timeframe;
      const suffix = tf ? `@${tf}` : "";
      return `${s.symbol}${suffix}[${s.kind}]`;
    });
    this.log(`Fast path: watching ${subs.join(", ")}`);

    // Seed each started strategy with enough historical closes for its indicators.
    for (const strat of strategies) {
      this.seedStrategy(strat).catch((e: any) => {
        this.log(`[Seed error] ${strat.symbol} ${strat.id.slice(0, 8)}: ${e.message ?? e}`);
      });
    }
  }

  /**
   * Seed a Strategy's indicator state with historical candles. Currently only
   * SignalStrategy needs this; other kinds can override or ignore via noop.
   */
  private async seedStrategy(strat: import("./strategy/base.js").Strategy): Promise<void> {
    if (!(strat instanceof SignalStrategy)) return;
    const tf = strat.timeframe;
    const candles = await this.agent.exchange.fetchOhlcv(strat.symbol, tf, 200);
    const closes = candles.map((c: any) => c.close as number);
    strat.seedHistory(closes);
  }

  private triggerReview(): void {
    const prompt = this.reviewer.buildReviewPrompt();
    this.agent.chatInSession(this.systemSessionId, `[REVIEW]\n${prompt}`).then((response) => {
      this.reviewer.saveReviewResult(this.systemSessionId, response);
      this.ipc.broadcast({
        type: "event",
        kind: "review",
        data: { summary: response.slice(0, 200) },
        timestamp: Date.now(),
      });
    }).catch((e) => this.log(`[Review error] ${e.message ?? e}`));
  }

  private patchScheduleHandler(): void {
    const original = TOOL_HANDLERS.schedule;
    if (original) {
      const memory = this.memory;
      TOOL_HANDLERS.schedule = async (args) => original({ memory, ...args });
    }
  }

  private async onHeartbeatResponse(response: string): Promise<void> {
    if (!response.toLowerCase().includes("all clear")) {
      this.ipc.broadcast({
        type: "event",
        kind: "heartbeat",
        data: { response: response.slice(0, 300) },
        timestamp: Date.now(),
      });
      if (this.notifier.enabled) await this.notifier.send(response);
    }
  }

  private cronAbort: AbortController | null = null;

  private async cronLoop(): Promise<void> {
    this.cronAbort = new AbortController();
    const signal = this.cronAbort.signal;
    while (!this.shuttingDown) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const t = setTimeout(resolve, 30_000);
        signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
      });
      if (this.shuttingDown) break;
      const dueJobs = this.memory.getDueCronJobs();
      for (const job of dueJobs) {
        try {
          const response = await this.agent.chatInSession(
            this.systemSessionId,
            `[CRON] Execute scheduled task: ${job.description}`,
          );
          this.memory.saveMessage(this.systemSessionId, "user", `[CRON] ${job.description}`);
          this.memory.saveMessage(this.systemSessionId, "assistant", response);
          const interval = parseInt(job.cron_expr.replace("every_", "").replace("m", ""), 10);
          const nextRun = new Date(Date.now() + interval * 60_000).toISOString();
          this.memory.updateCronNextRun(job.id, nextRun);
        } catch (e: any) {
          this.log(`[Cron error] ${e.message ?? e}`);
        }
      }
    }
  }

  private log(msg: string): void {
    const ts = new Date().toISOString();
    process.stderr.write(`[${ts}] ${msg}\n`);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async run(): Promise<void> {
    this.log(`Crypto daemon starting (pid ${process.pid})`);
    this.log(
      `Mode: ${config.paperTrading ? "PAPER" : "LIVE"} | Exchange: ${config.defaultExchange} | Soul: ${this.agent.soul.name}`,
    );

    await this.ipc.start();
    this.log(`IPC listening on ${this.ipc.socketPath}`);

    await this.heartbeat.start();
    this.log(`Heartbeat started (interval: ${config.heartbeatInterval}s)`);

    this.cronLoop();
    await this.startFastPath();

    this.log("Ready. Attach a client with `crypto-agent` or `npm run dev`.");

    // Wait forever (until signal)
    await new Promise<void>((resolve) => {
      const shutdown = async (sig: string) => {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        this.cronAbort?.abort();
        this.log(`Received ${sig}, shutting down...`);
        try {
          await this.ipc.stop(`Daemon received ${sig}`);
          await this.runtime?.stopAll();
          await this.marketFeed?.close();
          await this.heartbeat.stop();
          await this.agent.close();
          this.memory.close();
        } catch (e: any) {
          this.log(`Shutdown error: ${e.message ?? e}`);
        }
        releaseDaemonLock();
        resolve();
      };
      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    });
  }
}

export async function runDaemon(): Promise<void> {
  try {
    acquireDaemonLock();
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      process.stderr.write(
        `❌ Another crypto-daemon is already running (pid ${err.pid})\n` +
          `   Stop it first: kill ${err.pid}\n` +
          `   Socket: ${socketPath()}\n`,
      );
      process.exit(1);
    }
    throw err;
  }

  try {
    await new CryptoDaemon().run();
  } finally {
    releaseDaemonLock();
  }
}

runDaemon().catch((e) => {
  process.stderr.write(`Fatal: ${e.message ?? e}\n`);
  releaseDaemonLock();
  process.exit(1);
});
