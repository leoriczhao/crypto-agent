import { registerTool } from "./registry.js";
import { resolveToolTradingContext } from "./trading-context.js";
import { collectDeploymentHealth, renderDeploymentHealthDetail } from "../strategy/deployment-health.js";
import type { StrategyDeploymentMode } from "../memory.js";

function modeValue(value: unknown): StrategyDeploymentMode {
  return String(value || "PAPER").toUpperCase() === "LIVE" ? "LIVE" : "PAPER";
}

registerTool(
  "deploy_strategy",
  "Manage strategy package deployments. Activates, pauses, resumes, stops, and lists deployments tied to bot allocations.",
  {
    type: "object",
    properties: {
      action: { type: "string", enum: ["activate", "pause", "resume", "stop", "status"], default: "status" },
      deployment_id: { type: "string" },
      package_id: { type: "string" },
      package_version: { type: "integer", default: 1 },
      mode: { type: "string", enum: ["PAPER", "LIVE"], default: "PAPER" },
      capital_usdt: { type: "number" },
      runtime_policy: { type: "object" },
      resident_trader_id: { type: "string" },
    },
  },
  ["memory", "sessionId", "strategy_deployment_service"],
  async ({
    memory,
    sessionId,
    strategy_deployment_service,
    action = "status",
    deployment_id = "",
    package_id = "",
    package_version = 1,
    mode = "PAPER",
    capital_usdt,
    runtime_policy,
    resident_trader_id = "",
  }) => {
    try {
      if (!memory) return "Error: memory is not initialized";

      if (action === "status") {
        const deployments = memory.listStrategyDeployments();
        if (!deployments.length) return "No strategy deployments.";
        const lines = ["Strategy Deployments:", "ID | Status | Mode | Package | Bot | Allocation", "-".repeat(110)];
        for (const dep of deployments) {
          lines.push(`${dep.id} | ${dep.status} | ${dep.mode} | ${dep.packageId}@${dep.packageVersion} | ${dep.botId} | ${dep.capitalAllocationId}`);
          const instances = memory.listStrategyInstances(dep.id);
          if (instances.length) {
            lines.push("  Instances:");
            for (const instance of instances) {
              lines.push(
                `    ${instance.id} | ${instance.enabled ? "enabled" : "disabled"} | ${instance.kind} | ${instance.symbol} | allocated=${instance.allocatedUsdt} | bot=${instance.botId} | account=${instance.tradingAccountId}`,
              );
            }
          }
          if (dep.mode === "PAPER") {
            lines.push(...renderDeploymentHealthDetail(collectDeploymentHealth(memory, dep, instances)));
          }
        }
        return lines.join("\n");
      }

      if (!strategy_deployment_service) return "Error: strategy deployment service is not initialized";

      if (action === "pause" || action === "resume" || action === "stop") {
        const deploymentId = String(deployment_id || "").trim();
        if (!deploymentId) return "Error: deployment_id is required";
        if (action === "pause") await strategy_deployment_service.pause(deploymentId);
        if (action === "resume") await strategy_deployment_service.resume(deploymentId);
        if (action === "stop") await strategy_deployment_service.stop(deploymentId);
        const pastTense = action === "pause" ? "paused" : action === "resume" ? "resumed" : "stopped";
        return `Strategy deployment ${deploymentId} ${pastTense}.`;
      }

      const packageId = String(package_id || "").trim();
      if (!packageId) return "Error: package_id is required";
      const ctx = resolveToolTradingContext(memory, sessionId);
      const capital = Number(capital_usdt);
      const existing = memory.getBotAllocation(ctx.botId, ctx.tradingAccountId, "USDT");
      const allocation = capital > 0
        ? memory.ensureBotAllocation({
            botId: ctx.botId,
            tradingAccountId: ctx.tradingAccountId,
            asset: "USDT",
            amount: capital,
          })
        : existing;
      if (!allocation) return "Error: capital_usdt is required when no bot allocation exists";

      const result = await strategy_deployment_service.activate({
        id: String(deployment_id || "").trim() || undefined,
        packageId,
        packageVersion: Number(package_version) || 1,
        mode: modeValue(mode),
        tradingAccountId: ctx.tradingAccountId,
        botId: ctx.botId,
        capitalAllocationId: allocation.id,
        residentTraderId: String(resident_trader_id || "") || ctx.actorId,
        runtimePolicy: runtime_policy && typeof runtime_policy === "object" && !Array.isArray(runtime_policy)
          ? runtime_policy as Record<string, any>
          : {},
        allocatedUsdt: allocation.allocated,
      });

      return [
        `Strategy deployment active: ${result.deployment.id}`,
        `package=${result.deployment.packageId}@${result.deployment.packageVersion}`,
        `mode=${result.deployment.mode}`,
        `bot=${result.deployment.botId}`,
        `allocation=${result.deployment.capitalAllocationId}`,
        `instances=${result.instances.map((i: any) => `${i.id}[${i.kind}:${i.symbol}]`).join(", ")}`,
      ].join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
