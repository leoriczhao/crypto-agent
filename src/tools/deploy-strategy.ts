import { registerTool } from "./registry.js";
import { resolveToolTradingContext } from "./trading-context.js";
import { collectDeploymentHealth, renderDeploymentHealthDetail } from "../strategy/deployment-health.js";
import { assertPackageDeployable, compileStrategyPackage } from "../strategy/package-compiler.js";
import type { StrategyDeploymentMode } from "../memory.js";

function modeValue(value: unknown): StrategyDeploymentMode {
  return String(value || "PAPER").toUpperCase() === "LIVE" ? "LIVE" : "PAPER";
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

registerTool(
  "deploy_strategy",
  "Manage strategy package deployments. Activates, pauses, resumes, stops, and lists deployments tied to bot allocations.",
  {
    type: "object",
    properties: {
      action: { type: "string", enum: ["activate", "check", "pause", "resume", "stop", "status"], default: "status" },
      deployment_id: { type: "string" },
      package_id: { type: "string" },
      package_version: { type: "integer", default: 1 },
      mode: { type: "string", enum: ["PAPER", "LIVE"], default: "PAPER" },
      capital_usdt: { type: "number" },
      runtime_policy: { type: "object" },
      resident_trader_id: { type: "string" },
    },
  },
  ["memory", "sessionId", "strategy_deployment_service", "config"],
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
    config,
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
      const targetMode = modeValue(mode);
      const packageVersion = Number(package_version) || 1;
      const runtimePolicy = objectValue(runtime_policy);

      if (action === "check") {
        const pkg = memory.getStrategyPackage(packageId, packageVersion);
        if (!pkg) return `Error: strategy package not found: ${packageId}@${packageVersion}`;
        const issues: string[] = [];
        try {
          assertPackageDeployable(pkg, targetMode);
        } catch (e: any) {
          issues.push(e.message ?? String(e));
        }
        const allocatedUsdt = Number(capital_usdt) > 0
          ? Number(capital_usdt)
          : Number(pkg.riskPolicy.maxTotalNotionalUsdt ?? 0) || undefined;
        let instances: ReturnType<typeof compileStrategyPackage> = [];
        try {
          instances = compileStrategyPackage({
            package: pkg,
            deploymentId: packageId,
            botId: "preflight-bot",
            tradingAccountId: "preflight-account",
            allocatedUsdt,
          });
        } catch (e: any) {
          issues.push(e.message ?? String(e));
        }
        if (targetMode === "LIVE") {
          if (runtimePolicy.live_approved !== true) issues.push("runtime_policy.live_approved=true is required for LIVE activation");
          const maxLeverage = Number(pkg.riskPolicy.maxLeverage ?? 0);
          const configuredMax = Number(config?.contractMaxLeverage ?? 0);
          if (maxLeverage > 0 && configuredMax > 0 && maxLeverage > configuredMax) {
            issues.push(`risk_policy.maxLeverage ${maxLeverage} exceeds configured contract max ${configuredMax}`);
          }
          for (const instance of instances) {
            if (!instance.symbol.includes(":")) {
              issues.push(`LIVE deployment requires swap contract symbol with settlement suffix: ${instance.symbol}`);
            }
          }
        }
        return [
          `Strategy deployment check: ${issues.length ? "blocked" : "ok"}`,
          `mode=${targetMode}`,
          `package=${packageId}@${packageVersion}`,
          `instances=${instances.map((i: any) => `${i.id}[${i.kind}:${i.symbol}]`).join(", ") || "none"}`,
          `margin_mode=${config?.contractMarginMode ?? "isolated"}`,
          `position_mode=${config?.contractPositionMode ?? "auto"}`,
          `max_leverage=${pkg.riskPolicy.maxLeverage ?? "n/a"}`,
          `live_approved=${runtimePolicy.live_approved === true}`,
          issues.length ? `issues=${issues.join("; ")}` : "issues=none",
        ].join("\n");
      }

      if (targetMode === "LIVE" && runtimePolicy.live_approved !== true) {
        return "Error: runtime_policy.live_approved=true is required before LIVE strategy activation.";
      }

      const ctx = resolveToolTradingContext(memory, sessionId);
      const residentTraderId = String(resident_trader_id || "").trim();
      const residentTrader = residentTraderId ? memory.getResidentAgent(residentTraderId) : null;
      if (residentTraderId && !residentTrader) return `Error: resident trader not found: ${residentTraderId}`;
      if (residentTrader && residentTrader.type !== "trader") return `Error: resident agent is not a trader: ${residentTraderId}`;
      if (residentTrader && residentTrader.status !== "active") return `Error: resident trader is not active: ${residentTraderId}`;
      const activationBotId = residentTrader?.botId ?? ctx.botId;
      const activationTradingAccountId = residentTrader?.tradingAccountId ?? ctx.tradingAccountId;
      const capital = Number(capital_usdt);
      const existing = memory.getBotAllocation(activationBotId, activationTradingAccountId, "USDT");
      const allocation = capital > 0
        ? memory.ensureBotAllocation({
            botId: activationBotId,
            tradingAccountId: activationTradingAccountId,
            asset: "USDT",
            amount: capital,
          })
        : existing;
      if (!allocation) return "Error: capital_usdt is required when no bot allocation exists";

      const result = await strategy_deployment_service.activate({
        id: String(deployment_id || "").trim() || undefined,
        packageId,
        packageVersion,
        mode: targetMode,
        tradingAccountId: activationTradingAccountId,
        botId: activationBotId,
        capitalAllocationId: allocation.id,
        residentTraderId: residentTrader?.id ?? ctx.actorId,
        runtimePolicy,
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
