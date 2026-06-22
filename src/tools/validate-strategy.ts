import { registerTool } from "./registry.js";
import { compileStrategyPackage } from "../strategy/package-compiler.js";
import { BacktestEngine } from "../backtest.js";
import type { SignalExecutableSpec, StrategyExecutableSpec } from "../strategy/package-types.js";

const SIGNAL_THRESHOLDS = {
  minTrades: 10,
  minSharpe: 0.3,
  maxDrawdownPct: 25,
};

function signalBacktestReasons(metrics: {
  totalTrades: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): string[] {
  const reasons: string[] = [];
  if (metrics.totalTrades < SIGNAL_THRESHOLDS.minTrades) {
    reasons.push(`totalTrades ${metrics.totalTrades} < ${SIGNAL_THRESHOLDS.minTrades}`);
  }
  if (metrics.sharpeRatio <= SIGNAL_THRESHOLDS.minSharpe) {
    reasons.push(`sharpe ${metrics.sharpeRatio.toFixed(2)} <= ${SIGNAL_THRESHOLDS.minSharpe}`);
  }
  if (metrics.maxDrawdown >= SIGNAL_THRESHOLDS.maxDrawdownPct) {
    reasons.push(`maxDrawdown ${metrics.maxDrawdown.toFixed(2)} >= ${SIGNAL_THRESHOLDS.maxDrawdownPct}`);
  }
  return reasons;
}

registerTool(
  "validate_strategy",
  "Validate a strategy package. Signal packages run condition-based backtests; grid/ladder require explicit paper-only waiver until simulators exist.",
  {
    type: "object",
    properties: {
      action: { type: "string", enum: ["run", "list", "waive_for_paper"], default: "run" },
      package_id: { type: "string" },
      package_version: { type: "integer", default: 1 },
      report: { type: "string" },
      created_by: { type: "string" },
    },
    required: ["package_id"],
  },
  ["memory", "market_data"],
  async ({ memory, market_data, action = "run", package_id, package_version = 1, report = "", created_by = "" }) => {
    try {
      if (!memory) return "Error: memory is not initialized";
      const packageId = String(package_id || "").trim();
      const version = Number(package_version) || 1;
      if (!packageId) return "Error: package_id is required";

      const pkg = memory.getStrategyPackage(packageId, version);
      if (!pkg) return `Error: strategy package not found: ${packageId}@${version}`;

      if (action === "list") {
        const validations = memory.listStrategyValidations(packageId, version);
        if (!validations.length) return `No validations for ${packageId}@${version}.`;
        return validations
          .map((v: any) => `${v.id} | ${v.validatorType} | ${v.status} | ${v.report ?? "-"}`)
          .join("\n");
      }

      if (action === "waive_for_paper") {
        const validation = memory.createStrategyValidation({
          packageId,
          packageVersion: version,
          validatorType: "paper_waiver",
          status: "waived",
          metrics: { waived: true },
          report: String(report || "Paper-only waiver."),
          createdBy: String(created_by || "") || null,
        });
        memory.setStrategyPackageValidation(packageId, version, "waived", validation.report);
        memory.setStrategyPackageStatus(packageId, version, "paper_ready");
        return [
          `Strategy validation recorded: ${validation.id}`,
          `package=${packageId}@${version}`,
          `validation=waived`,
          `status=paper_ready`,
        ].join("\n");
      }

      compileStrategyPackage({
        package: pkg,
        deploymentId: "validation",
        botId: "validation-bot",
        tradingAccountId: "validation-account",
        allocatedUsdt: Number(pkg.riskPolicy.maxTotalNotionalUsdt ?? 0),
      });
      const spec = pkg.executableSpec as StrategyExecutableSpec;

      if (spec.kind === "signal") {
        if (!market_data) return "Error: market_data is required for signal backtest validation";
        const signalSpec = spec as SignalExecutableSpec;
        const engine = new BacktestEngine(10000);
        const backtests = [];
        for (const symbol of signalSpec.symbols) {
          const ohlcv = await market_data.fetchOhlcv(symbol, signalSpec.timeframe, 300);
          const result = engine.runConditionBased(
            ohlcv,
            signalSpec.entry,
            signalSpec.exit,
            signalSpec.side,
            symbol,
            signalSpec.timeframe,
          );
          const reasons = signalBacktestReasons(result);
          backtests.push({
            symbol,
            timeframe: signalSpec.timeframe,
            candleCount: ohlcv.length,
            totalReturn: result.totalReturn,
            maxDrawdown: result.maxDrawdown,
            sharpeRatio: result.sharpeRatio,
            winRate: result.winRate,
            totalTrades: result.totalTrades,
            passed: reasons.length === 0,
            reasons,
          });
        }

        const passed = backtests.every((b) => b.passed);
        const validation = memory.createStrategyValidation({
          packageId,
          packageVersion: version,
          validatorType: "backtest_signal",
          status: passed ? "passed" : "failed",
          metrics: { compiler: "passed", thresholds: SIGNAL_THRESHOLDS, backtests },
          report: String(report || (passed
            ? "Signal package passed compiler and condition-based backtest validation."
            : "Signal package failed condition-based backtest validation.")),
          createdBy: String(created_by || "") || null,
        });
        memory.setStrategyPackageValidation(packageId, version, passed ? "passed" : "failed", validation.report);
        if (passed) memory.setStrategyPackageStatus(packageId, version, "paper_ready");
        return [
          `Strategy validation recorded: ${validation.id}`,
          `package=${packageId}@${version}`,
          `validator=backtest_signal`,
          `validation=${passed ? "passed" : "failed"}`,
          `status=${passed ? "paper_ready" : pkg.status}`,
          ...backtests.map((b) =>
            `backtest ${b.symbol} ${b.timeframe}: trades=${b.totalTrades} sharpe=${b.sharpeRatio.toFixed(2)} maxDD=${b.maxDrawdown.toFixed(2)}% win=${b.winRate.toFixed(1)}% ${b.passed ? "passed" : `failed (${b.reasons.join("; ")})`}`),
        ].join("\n");
      }

      if (spec.kind === "grid" || spec.kind === "ladder") {
        const validation = memory.createStrategyValidation({
          packageId,
          packageVersion: version,
          validatorType: "compiler",
          status: "pending",
          metrics: {
            compiler: "passed",
            executableKind: spec.kind,
            simulator: "not_implemented",
            paperWaiverRequired: true,
          },
          report: String(report || `${spec.kind} package compiled, but simulator validation is not implemented; use waive_for_paper for paper-only trials.`),
          createdBy: String(created_by || "") || null,
        });
        memory.setStrategyPackageValidation(packageId, version, "pending", validation.report);
        return [
          `Strategy validation recorded: ${validation.id}`,
          `package=${packageId}@${version}`,
          `validator=compiler`,
          `validation=pending`,
          `status=${pkg.status}`,
          `Use validate_strategy action=waive_for_paper before paper deployment until ${spec.kind} validation simulators exist.`,
        ].join("\n");
      }

      const validation = memory.createStrategyValidation({
        packageId,
        packageVersion: version,
        validatorType: "compiler",
        status: "passed",
        metrics: { compiler: "passed" },
        report: String(report || "Executable spec compiled successfully."),
        createdBy: String(created_by || "") || null,
      });
      memory.setStrategyPackageValidation(packageId, version, "passed", validation.report);
      memory.setStrategyPackageStatus(packageId, version, "paper_ready");
      return [
        `Strategy validation recorded: ${validation.id}`,
        `package=${packageId}@${version}`,
        `validation=passed`,
        `status=paper_ready`,
      ].join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
