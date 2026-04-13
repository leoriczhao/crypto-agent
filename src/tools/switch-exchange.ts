import { registerTool } from "./registry.js";

registerTool(
  "switch_exchange",
  "Switch the active exchange. Shows all connected exchanges if no exchange_id given.",
  {
    type: "object",
    properties: {
      exchange_id: { type: "string", description: "Exchange to switch to, e.g. okx, gateio, binance" },
    },
    required: [],
  },
  async ({ exchange_manager, exchange_id = "" }) => {
    try {
      const exchanges = exchange_manager.list();
      const active = exchange_manager.activeId;

      if (!exchange_id) {
        const lines = ["Connected Exchanges:", "=".repeat(35)];
        for (const exId of exchanges) {
          const marker = exId === active ? " \u2190 active" : "";
          lines.push(`  \u2022 ${exId}${marker}`);
        }
        lines.push("", "Exchange Status:", "=".repeat(45));
        for (const exId of exchanges) {
          const ex = exchange_manager.get(exId);
          try {
            const ticker = await ex.fetchTicker("BTC/USDT");
            lines.push(`  \u2705 ${exId}: online (BTC=$${ticker.last.toLocaleString("en-US", { minimumFractionDigits: 2 })})`);
          } catch (e: any) {
            lines.push(`  \u274c ${exId}: error (${e.message ?? e})`);
          }
        }
        return lines.join("\n");
      }

      exchange_manager.setActive(exchange_id);
      return `Switched active exchange to: ${exchange_id}`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
