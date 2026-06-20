import { registerTool } from "./registry.js";
import type { MandateValidationStatus, StrategyMandateStatus } from "../memory.js";

const VALID_STATUSES = new Set<StrategyMandateStatus>(["draft", "active", "deprecated"]);
const VALID_VALIDATION_STATUSES = new Set<MandateValidationStatus>(["deferred", "pending", "validated", "rejected"]);

function normalizeStatus(value: unknown, fallback: StrategyMandateStatus): StrategyMandateStatus {
  const status = String(value || "");
  return VALID_STATUSES.has(status as StrategyMandateStatus) ? status as StrategyMandateStatus : fallback;
}

function normalizeValidationStatus(value: unknown, fallback: MandateValidationStatus): MandateValidationStatus {
  const status = String(value || "");
  return VALID_VALIDATION_STATUSES.has(status as MandateValidationStatus) ? status as MandateValidationStatus : fallback;
}

function normalizeBody(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return {};
}

registerTool(
  "strategy_mandate",
  "Create and inspect reusable strategy mandate resources. Mandates are playbooks assigned to resident agents; validation status records whether backtest approval is deferred, pending, validated, or rejected.",
  {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "activate", "deprecate"], default: "list" },
      id: { type: "string", description: "Stable mandate id, e.g. trend_pullback_v1" },
      name: { type: "string", description: "Human-readable mandate name" },
      status: { type: "string", enum: ["draft", "active", "deprecated"], default: "draft" },
      description: { type: "string" },
      body: { type: "object", description: "Structured strategy playbook, including universe, entry/exit, risk, and required data" },
      validation_status: { type: "string", enum: ["deferred", "pending", "validated", "rejected"], default: "deferred" },
      validation_notes: { type: "string", description: "Backtest or validation notes. Use deferred notes when platform support is not built yet." },
    },
  },
  ["memory", "sessionId"],
  async ({
    memory,
    sessionId,
    action = "list",
    id = "",
    name = "",
    status = "draft",
    description = "",
    body,
    validation_status = "deferred",
    validation_notes = "",
  }) => {
    try {
      if (!memory) return "Error: memory is not initialized";

      if (action === "create") {
        const mandateName = String(name).trim();
        if (!mandateName) return "Error: name is required";
        const mandate = memory.createStrategyMandate({
          id: String(id || "").trim() || undefined,
          name: mandateName,
          status: normalizeStatus(status, "draft"),
          description: String(description || ""),
          body: normalizeBody(body),
          validationStatus: normalizeValidationStatus(validation_status, "deferred"),
          validationNotes: String(validation_notes || "") || null,
          createdBy: sessionId ?? null,
        });
        return [
          `Strategy mandate created: ${mandate.name} (${mandate.id})`,
          `status=${mandate.status}`,
          `validation=${mandate.validationStatus}`,
          `notes=${mandate.validationNotes ?? "none"}`,
        ].join("\n");
      }

      if (action === "activate" || action === "deprecate") {
        const mandateId = String(id || "").trim();
        if (!mandateId) return "Error: id is required";
        const mandate = memory.getStrategyMandate(mandateId);
        if (!mandate) return `Error: strategy mandate not found: ${mandateId}`;
        memory.setStrategyMandateStatus(mandateId, action === "activate" ? "active" : "deprecated");
        return `Strategy mandate ${mandateId} ${action === "activate" ? "activated" : "deprecated"}.`;
      }

      const mandates = memory.listStrategyMandates();
      if (!mandates.length) return "No strategy mandates.";
      const lines = ["Strategy Mandates:", "ID | Status | Validation | Name | Notes", "-".repeat(90)];
      for (const mandate of mandates) {
        lines.push(`${mandate.id} | ${mandate.status} | ${mandate.validationStatus} | ${mandate.name} | ${mandate.validationNotes ?? "-"}`);
      }
      return lines.join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
