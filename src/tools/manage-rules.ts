import { registerTool } from "./registry.js";

registerTool(
  "manage_rules",
  "Manage automated trading rules and risk parameters.\nActions:\n- list: show all rules\n- enable/disable: toggle a rule by ID\n- delete: remove a rule\n- risk: show/update risk parameters",
  {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "enable", "disable", "delete", "risk", "update_risk"],
        description: "Action to perform",
      },
      rule_id: { type: "string", description: "Rule ID (for enable/disable/delete)" },
      risk_params: {
        type: "object",
        description: "Risk params to update (for update_risk)",
        properties: {
          max_position_pct: { type: "number" },
          max_exposure_pct: { type: "number" },
          max_drawdown_pct: { type: "number" },
          max_daily_loss_pct: { type: "number" },
          max_concurrent_positions: { type: "number" },
        },
      },
    },
    required: ["action"],
  },
  async ({ strategy_store, action, rule_id, risk_params }) => {
    try {
      if (!strategy_store) return "Error: strategy engine not initialized";

      if (action === "list") {
        const rules = strategy_store.getAllRules();
        if (!rules.length) return "No strategy rules configured.";
        const lines = ["Active Strategy Rules:", "=".repeat(50)];
        for (const r of rules) {
          const status = r.enabled ? "ON " : "OFF";
          lines.push(`[${status}] ${r.id.slice(0, 8)}… | ${r.symbol} ${r.side} | $${r.positionSizeUsdt} | SL:${r.stopLossPct}% TP:${r.takeProfitPct}%`);
          lines.push(`      Entry: ${r.entry.map((c: any) => `${c.indicator} ${c.operator} ${c.value}`).join(" AND ")}`);
          lines.push(`      Exit:  ${r.exit.map((c: any) => `${c.indicator} ${c.operator} ${c.value}`).join(" AND ")}`);
        }
        return lines.join("\n");
      }

      if (action === "enable" || action === "disable") {
        if (!rule_id) return "Error: provide rule_id";
        const updated = strategy_store.updateRule(rule_id, { enabled: action === "enable" });
        return updated
          ? `Rule ${rule_id.slice(0, 8)}… ${action}d.`
          : `Rule not found: ${rule_id}`;
      }

      if (action === "delete") {
        if (!rule_id) return "Error: provide rule_id";
        return strategy_store.removeRule(rule_id)
          ? `Rule ${rule_id.slice(0, 8)}… deleted.`
          : `Rule not found: ${rule_id}`;
      }

      if (action === "risk") {
        const rp = strategy_store.riskParams;
        return [
          "Risk Parameters:",
          "=".repeat(40),
          `Max Position Size:       ${rp.maxPositionPct}%`,
          `Max Total Exposure:      ${rp.maxExposurePct}%`,
          `Max Drawdown (emergency): ${rp.maxDrawdownPct}%`,
          `Max Daily Loss:          ${rp.maxDailyLossPct}%`,
          `Max Concurrent Positions: ${rp.maxConcurrentPositions}`,
        ].join("\n");
      }

      if (action === "update_risk" && risk_params) {
        const patch: Record<string, number> = {};
        if (risk_params.max_position_pct != null) patch.maxPositionPct = risk_params.max_position_pct;
        if (risk_params.max_exposure_pct != null) patch.maxExposurePct = risk_params.max_exposure_pct;
        if (risk_params.max_drawdown_pct != null) patch.maxDrawdownPct = risk_params.max_drawdown_pct;
        if (risk_params.max_daily_loss_pct != null) patch.maxDailyLossPct = risk_params.max_daily_loss_pct;
        if (risk_params.max_concurrent_positions != null) patch.maxConcurrentPositions = risk_params.max_concurrent_positions;
        strategy_store.setRiskParams(patch);
        return `Risk parameters updated: ${JSON.stringify(patch)}`;
      }

      return `Unknown action: ${action}`;
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
