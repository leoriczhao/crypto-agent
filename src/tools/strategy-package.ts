import { registerTool } from "./registry.js";
import type { StrategyPackageStatus, StrategyPackageValidationStatus } from "../memory.js";

const PACKAGE_STATUSES = new Set<StrategyPackageStatus>(["draft", "submitted", "paper_ready", "live_ready", "rejected", "deprecated"]);
const VALIDATION_STATUSES = new Set<StrategyPackageValidationStatus>(["not_run", "pending", "passed", "failed", "waived"]);

function obj(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, any>;
    } catch {}
  }
  return {};
}

function status(value: unknown, fallback: StrategyPackageStatus): StrategyPackageStatus {
  const s = String(value || "");
  return PACKAGE_STATUSES.has(s as StrategyPackageStatus) ? s as StrategyPackageStatus : fallback;
}

function validation(value: unknown, fallback: StrategyPackageValidationStatus): StrategyPackageValidationStatus {
  const s = String(value || "");
  return VALIDATION_STATUSES.has(s as StrategyPackageValidationStatus) ? s as StrategyPackageValidationStatus : fallback;
}

registerTool(
  "strategy_package",
  "Create and inspect versioned strategy packages. A package contains a human mandate, executable strategy spec, risk policy, and validation status.",
  {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "show", "submit", "reject", "deprecate"], default: "list" },
      id: { type: "string" },
      version: { type: "integer", default: 1 },
      family_id: { type: "string" },
      name: { type: "string" },
      status: { type: "string", enum: ["draft", "submitted", "paper_ready", "live_ready", "rejected", "deprecated"], default: "draft" },
      source: { type: "string", default: "agent" },
      mandate: { type: "object" },
      executable_spec: { type: "object" },
      risk_policy: { type: "object" },
      validation_status: { type: "string", enum: ["not_run", "pending", "passed", "failed", "waived"], default: "not_run" },
      validation_summary: { type: "string" },
    },
  },
  ["memory", "sessionId"],
  async ({
    memory,
    sessionId,
    action = "list",
    id = "",
    version = 1,
    family_id = "",
    name = "",
    status: inputStatus = "draft",
    source = "agent",
    mandate,
    executable_spec,
    risk_policy,
    validation_status = "not_run",
    validation_summary = null,
  }) => {
    try {
      if (!memory) return "Error: memory is not initialized";

      if (action === "create") {
        const packageName = String(name || "").trim();
        if (!packageName) return "Error: name is required";
        const pkg = memory.createStrategyPackage({
          id: String(id || "").trim() || undefined,
          version: Number(version) || 1,
          familyId: String(family_id || id || "").trim() || undefined,
          name: packageName,
          status: status(inputStatus, "draft"),
          source: String(source || "agent"),
          mandate: obj(mandate),
          executableSpec: obj(executable_spec),
          riskPolicy: obj(risk_policy),
          validationStatus: validation(validation_status, "not_run"),
          validationSummary: validation_summary ? String(validation_summary) : null,
          authorRunId: null,
          authorAgentId: null,
        });
        return [
          `Strategy package created: ${pkg.name} (${pkg.id}@${pkg.version})`,
          `status=${pkg.status}`,
          `validation=${pkg.validationStatus}`,
          `source=${pkg.source}`,
          `created_by_session=${sessionId ?? "none"}`,
        ].join("\n");
      }

      if (action === "show") {
        const pkg = memory.getStrategyPackage(String(id), Number(version) || 1);
        if (!pkg) return `Error: strategy package not found: ${id}@${version}`;
        return JSON.stringify(pkg, null, 2);
      }

      if (action === "submit" || action === "reject" || action === "deprecate") {
        const packageId = String(id || "").trim();
        const packageVersion = Number(version) || 1;
        if (!packageId) return "Error: id is required";
        const next = action === "submit" ? "submitted" : action === "reject" ? "rejected" : "deprecated";
        if (!memory.getStrategyPackage(packageId, packageVersion)) {
          return `Error: strategy package not found: ${packageId}@${packageVersion}`;
        }
        memory.setStrategyPackageStatus(packageId, packageVersion, next);
        return `Strategy package ${packageId}@${packageVersion} status=${next}.`;
      }

      const packages = memory.listStrategyPackages();
      if (!packages.length) return "No strategy packages.";
      const lines = ["Strategy Packages:", "ID@Version | Status | Validation | Name", "-".repeat(90)];
      for (const pkg of packages) {
        lines.push(`${pkg.id}@${pkg.version} | ${pkg.status} | ${pkg.validationStatus} | ${pkg.name}`);
      }
      return lines.join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
