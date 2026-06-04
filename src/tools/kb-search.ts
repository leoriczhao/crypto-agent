import { registerTool } from "./registry.js";

registerTool(
  "kb_search",
  "Search the strategy research KB for past hypotheses and their outcomes. Use this BEFORE starting new research to check what's been tried. Example queries: 'BTC rsi', 'SMA cross', symbol name.",
  {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text query matched against hypothesis / failure_reason / symbol" },
      outcome: {
        type: "string",
        enum: ["adopted", "rejected", "pending_review"],
        description: "Filter by outcome (optional)",
      },
      limit: { type: "number", default: 10, description: "Max entries to return (1-50)" },
    },
  },
  ["memory"],
  async ({ memory, query, outcome, limit }) => {
    if (!memory) return "Error: memory unavailable";
    try {
      const entries = memory.searchResearchKb({ query, outcome, limit: limit ?? 10 });
      if (!entries.length) return "KB: no matching entries.";
      const lines = entries.map((e: any) => {
        const sym = e.symbol ? ` [${e.symbol}${e.timeframe ? `/${e.timeframe}` : ""}]` : "";
        const rule = e.ruleId ? ` → rule ${e.ruleId.slice(0, 8)}…` : "";
        const reason = e.failureReason ? ` — why: ${e.failureReason}` : "";
        const summary = e.backtestSummary ? `\n    bt: ${e.backtestSummary.slice(0, 200)}` : "";
        return `#${e.id}${sym} [${e.outcome}] ${e.hypothesis}${rule}${reason}${summary}`;
      });
      return `KB (${entries.length} entries):\n${lines.join("\n\n")}`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
