import type {
  Memory,
  PaperFillRow,
  PaperOrderRow,
  PaperPositionRow,
  PersistedPendingOrder,
  StrategyDeploymentRow,
  StrategyInstanceRow,
  StrategyRuntimeStateRow,
} from "../memory.js";

export interface DeploymentHealth {
  deployment: StrategyDeploymentRow;
  instances: StrategyInstanceRow[];
  positions: PaperPositionRow[];
  openOrders: PaperOrderRow[];
  pendingOrders: PersistedPendingOrder[];
  fills: PaperFillRow[];
  states: StrategyRuntimeStateRow[];
  marginUsdt: number;
  unrealizedPnl: number;
  realizedPnl: number;
  lastSignal: StrategyRuntimeStateRow | null;
  lastError: StrategyRuntimeStateRow | null;
}

export function formatHealthNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return String(Number(n.toFixed(8)));
}

function formatPrice(value: number | null | undefined): string {
  return value == null ? "market" : formatHealthNumber(value);
}

function isInstancePaperOrder(order: PaperOrderRow, instanceIds: Set<string>): boolean {
  return order.actorType === "strategy" && !!order.actorId && instanceIds.has(order.actorId);
}

function latestBy<T>(items: T[], getValue: (item: T) => string | null): T | null {
  let best: T | null = null;
  let bestValue = "";
  for (const item of items) {
    const value = getValue(item);
    if (!value) continue;
    if (!best || value > bestValue) {
      best = item;
      bestValue = value;
    }
  }
  return best;
}

function clip(value: unknown, max = 120): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function formatSignalSummary(signal: Record<string, any> | null): string | null {
  if (!signal) return null;
  const orderType = signal.orderType ?? "market";
  return [
    signal.symbol ?? "unknown",
    signal.action ?? "unknown",
    signal.side ?? "unknown",
    `size=${formatHealthNumber(signal.sizeUsdt)}`,
    `order=${orderType}`,
    `price=${formatPrice(orderType === "limit" ? signal.limitPrice : null)}`,
    `reason=${clip(signal.reason) || "n/a"}`,
  ].join(" ");
}

export function collectDeploymentHealth(
  memory: Memory,
  deployment: StrategyDeploymentRow,
  instances: StrategyInstanceRow[],
): DeploymentHealth {
  const symbols = new Set(instances.map((i) => i.symbol));
  const instanceIds = new Set(instances.map((i) => i.id));
  const positions = deployment.mode === "PAPER"
    ? memory
        .listPaperPositions({ tradingAccountId: deployment.tradingAccountId, botId: deployment.botId })
        .filter((p: PaperPositionRow) => symbols.has(p.symbol))
    : [];
  const openOrders = deployment.mode === "PAPER"
    ? memory
        .listPaperOpenOrders({ tradingAccountId: deployment.tradingAccountId, botId: deployment.botId })
        .filter((o: PaperOrderRow) => symbols.has(o.symbol) && isInstancePaperOrder(o, instanceIds))
    : [];
  const fills = deployment.mode === "PAPER"
    ? memory
        .listPaperFills({ tradingAccountId: deployment.tradingAccountId, botId: deployment.botId })
        .filter((f: PaperFillRow) => symbols.has(f.symbol) && f.actorType === "strategy" && !!f.actorId && instanceIds.has(f.actorId))
    : [];
  const pendingOrders = instances.flatMap((i) => memory.getOpenPendingOrdersByStrategy(i.id));
  const states = instances
    .map((i) => memory.getStrategyRuntimeState(i.id))
    .filter((s): s is StrategyRuntimeStateRow => !!s);

  return {
    deployment,
    instances,
    positions,
    openOrders,
    pendingOrders,
    fills,
    states,
    marginUsdt: positions.reduce((sum: number, p: PaperPositionRow) => sum + p.marginUsdt, 0),
    unrealizedPnl: positions.reduce((sum: number, p: PaperPositionRow) => sum + p.unrealizedPnl, 0),
    realizedPnl: fills.reduce((sum: number, f: PaperFillRow) => sum + f.realizedPnl, 0),
    lastSignal: latestBy(states.filter((s) => !!s.lastSignal), (s) => s.lastSignalAt),
    lastError: latestBy(states.filter((s) => !!s.lastError), (s) => s.lastErrorAt),
  };
}

export function renderDeploymentHealthDetail(health: DeploymentHealth): string[] {
  const lines = [
    `  Paper: positions=${health.positions.length} open_orders=${health.openOrders.length} pending_orders=${health.pendingOrders.length} fills=${health.fills.length} margin=${formatHealthNumber(health.marginUsdt)} unrealized_pnl=${formatHealthNumber(health.unrealizedPnl)} realized_pnl=${formatHealthNumber(health.realizedPnl)}`,
  ];

  for (const position of health.positions) {
    lines.push(
      `    Position: ${position.symbol} ${position.positionSide} amount=${formatHealthNumber(position.amount)} entry=${formatHealthNumber(position.avgEntryPrice)} mark=${formatHealthNumber(position.markPrice)} margin=${formatHealthNumber(position.marginUsdt)} uPnL=${formatHealthNumber(position.unrealizedPnl)}`,
    );
  }
  for (const order of health.openOrders) {
    lines.push(
      `    OpenOrder: ${order.id} ${order.side} ${order.orderType} ${order.symbol} amount=${formatHealthNumber(order.amount)} price=${formatPrice(order.price)} actor=${order.actorId}`,
    );
  }
  for (const order of health.pendingOrders) {
    lines.push(
      `    PendingOrder: ${order.exchangeOrderId ?? `pending#${order.id}`} ${order.side} ${order.orderType} ${order.symbol} amount=${formatHealthNumber(order.amount)} price=${formatPrice(order.price)} strategy=${order.strategyId ?? "unknown"}`,
    );
  }
  for (const fill of health.fills.slice(-3)) {
    lines.push(
      `    Fill: ${fill.orderId} ${fill.side} ${fill.symbol} amount=${formatHealthNumber(fill.amount)} price=${formatHealthNumber(fill.price)} realized_pnl=${formatHealthNumber(fill.realizedPnl)}`,
    );
  }

  const signal = formatSignalSummary(health.lastSignal?.lastSignal ?? null);
  if (signal) lines.push(`    LastSignal: ${signal}`);
  if (health.lastError?.lastError) lines.push(`    LastError: ${clip(health.lastError.lastError)}`);
  return lines;
}

export function renderDeploymentHealthCompact(health: DeploymentHealth): string[] {
  const lines = [
    `  health: positions=${health.positions.length} open_orders=${health.openOrders.length} pending_orders=${health.pendingOrders.length} fills=${health.fills.length} margin=${formatHealthNumber(health.marginUsdt)} unrealized_pnl=${formatHealthNumber(health.unrealizedPnl)} realized_pnl=${formatHealthNumber(health.realizedPnl)}`,
  ];
  const signal = formatSignalSummary(health.lastSignal?.lastSignal ?? null);
  if (signal) lines.push(`  last_signal: ${signal}`);
  if (health.lastError?.lastError) lines.push(`  last_error: ${clip(health.lastError.lastError)}`);
  return lines;
}
