import { registerTool } from "./registry.js";
import { resolveToolTradingContext } from "./trading-context.js";

function formatUsdt(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

registerTool(
  "get_portfolio",
  "Get complete portfolio overview: asset balances, open positions with PnL, and open orders.",
  { type: "object", properties: {} },
  ["exchange", "broker", "memory", "sessionId"],
  async ({ exchange, broker, memory, sessionId }) => {
    try {
      const lines: string[] = [];
      const ctx = memory ? resolveToolTradingContext(memory, sessionId) : null;
      const allocation = ctx ? memory?.getBotAllocation?.(ctx.botId, ctx.tradingAccountId, "USDT") : null;
      const balance = broker && ctx ? await broker.fetchBalance(ctx.botId) : await exchange.fetchBalance();

      if (ctx && allocation) {
        lines.push(`Active Bot: ${ctx.botId} (${ctx.tradingAccountId})`);
        lines.push(
          `Allocation USDT: allocated ${formatUsdt(allocation.allocated)} | free ${formatUsdt(allocation.free)} | used ${formatUsdt(allocation.used)} | realized PnL ${formatUsdt(allocation.realizedPnl ?? 0)}`,
        );
        lines.push("");
      }

      if (Object.keys(balance).length) {
        lines.push("Asset     | Free         | Total");
        lines.push("-".repeat(40));
        for (const [asset, info] of Object.entries(balance).sort()) {
          const i = info as any;
          lines.push(`${asset.padEnd(9)} | ${i.free.toFixed(4).padStart(12)} | ${i.total.toFixed(4).padStart(12)}`);
        }
      } else {
        lines.push("No assets.");
      }
      lines.push("");

      const positions = broker && ctx ? await broker.fetchPositions(ctx.botId) : await exchange.fetchPositions();
      if (Object.keys(positions).length) {
        lines.push("Symbol           | Side   | Size         | Entry        | Mark         | PnL");
        lines.push("-".repeat(85));
        for (const [sym, pos] of Object.entries(positions) as any) {
          const side = (pos.side ?? "long").toUpperCase();
          const size = pos.contracts ?? pos.amount ?? 0;
          const entry = pos.avg_entry_price ?? 0;
          const mark = pos.current_price ?? 0;
          const pnl = pos.unrealized_pnl ?? 0;
          const lev = pos.leverage ? ` ${pos.leverage}x` : "";
          lines.push(
            `${sym.padEnd(16)} | ${side.padEnd(6)} | ${size.toFixed(4).padStart(12)} | ${entry.toFixed(2).padStart(12)} | ${mark.toFixed(2).padStart(12)} | ${(pnl >= 0 ? "+" : "") + pnl.toFixed(2).padStart(9)}${lev}`,
          );
        }
      } else {
        lines.push("No open positions.");
      }
      lines.push("");

      if (exchange._orders) {
        const orders = exchange._orders.slice(-20);
        if (orders.length) {
          lines.push("Recent Orders:");
          lines.push(JSON.stringify(orders, null, 2));
        }
      } else {
        const openOrders = broker && ctx ? await broker.fetchOpenOrders(null, ctx.botId) : await exchange.fetchOpenOrders();
        if (openOrders.length) {
          lines.push("Open Orders:");
          lines.push(JSON.stringify(openOrders, null, 2));
        }
      }

      return lines.join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
