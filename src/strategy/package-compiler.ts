import type { StrategyPackageRow, StrategyDeploymentMode } from "../memory.js";
import type {
  CompiledStrategyInstanceInput,
  CompileStrategyPackageInput,
  GridExecutableSpec,
  SignalExecutableSpec,
  StrategyExecutableSpec,
} from "./package-types.js";

function slug(value: string): string {
  const out = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return out || "strategy";
}

function requirePositive(value: unknown, name: string): number {
  const n = Number(value);
  if (!(n > 0)) throw new Error(`${name} must be > 0`);
  return n;
}

function requireString(value: unknown, name: string): string {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${name} is required`);
  return s;
}

function requireArray(value: unknown, name: string): any[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must be a non-empty array`);
  return value;
}

export function assertPackageDeployable(pkg: StrategyPackageRow, mode: StrategyDeploymentMode): void {
  if (mode === "PAPER") {
    if (pkg.status !== "paper_ready" && pkg.status !== "live_ready") {
      throw new Error(`Paper deployment requires package status paper_ready or live_ready, got ${pkg.status}`);
    }
    if (pkg.validationStatus !== "waived" && pkg.validationStatus !== "passed") {
      throw new Error(`Paper deployment requires waived or passed validation, got ${pkg.validationStatus}`);
    }
    return;
  }

  if (pkg.status !== "live_ready") {
    throw new Error(`Live deployment requires package status live_ready, got ${pkg.status}`);
  }
  if (pkg.validationStatus !== "passed") {
    throw new Error(`Live deployment requires passed validation, got ${pkg.validationStatus}`);
  }
}

export function compileStrategyPackage(input: CompileStrategyPackageInput): CompiledStrategyInstanceInput[] {
  const spec = input.package.executableSpec as StrategyExecutableSpec;
  switch (spec.kind) {
    case "signal":
      return compileSignal(input, spec);
    case "grid":
      return compileGrid(input, spec);
    case "ladder":
      throw new Error("Unsupported strategy package kind: ladder is not compiled in this slice");
    default:
      throw new Error(`Unsupported strategy package kind: ${(spec as any)?.kind ?? "unknown"}`);
  }
}

function compileSignal(input: CompileStrategyPackageInput, spec: SignalExecutableSpec): CompiledStrategyInstanceInput[] {
  const symbols = requireArray(spec.symbols, "signal symbols").map((s) => requireString(s, "symbol"));
  const timeframe = requireString(spec.timeframe, "signal timeframe");
  if (spec.side !== "long" && spec.side !== "short") throw new Error("signal side must be long or short");
  requireArray(spec.entry, "signal entry");
  requireArray(spec.exit, "signal exit");
  const positionSizeUsdt = requirePositive(spec.positionSizeUsdt, "signal positionSizeUsdt");
  const stopLossPct = requirePositive(spec.stopLossPct, "signal stopLossPct");
  const takeProfitPct = requirePositive(spec.takeProfitPct, "signal takeProfitPct");
  const totalAllocation = input.allocatedUsdt ?? Number(input.package.riskPolicy.maxTotalNotionalUsdt ?? 0);
  const perInstanceAllocation = totalAllocation > 0 ? totalAllocation / symbols.length : 0;

  return symbols.map((symbol) => ({
    id: `${input.deploymentId}:${slug(symbol)}`,
    deploymentId: input.deploymentId,
    packageId: input.package.id,
    packageVersion: input.package.version,
    kind: "signal",
    symbol,
    params: {
      timeframe,
      side: spec.side,
      entry: spec.entry,
      exit: spec.exit,
      positionSizeUsdt,
      stopLossPct,
      takeProfitPct,
    },
    enabled: true,
    allocatedUsdt: perInstanceAllocation,
    botId: input.botId,
    tradingAccountId: input.tradingAccountId,
  }));
}

function compileGrid(input: CompileStrategyPackageInput, spec: GridExecutableSpec): CompiledStrategyInstanceInput[] {
  const symbols = spec.symbols ?? (spec.symbol ? [spec.symbol] : []);
  if (!Array.isArray(symbols) || symbols.length !== 1) {
    throw new Error("grid package requires exactly one symbol");
  }
  const symbol = requireString(symbols[0], "grid symbol");
  if (spec.side !== "long") throw new Error("grid side must be long");
  const lowerPrice = requirePositive(spec.lowerPrice, "grid lowerPrice");
  const upperPrice = requirePositive(spec.upperPrice, "grid upperPrice");
  if (upperPrice <= lowerPrice) throw new Error("grid upperPrice must be greater than lowerPrice");
  const gridCount = requirePositive(spec.gridCount, "grid gridCount");
  if (!Number.isInteger(gridCount) || gridCount < 2) throw new Error("grid gridCount must be an integer >= 2");
  const sizePerGrid = requirePositive(spec.sizePerGrid, "grid sizePerGrid");
  const allocatedUsdt = input.allocatedUsdt ?? Number(input.package.riskPolicy.maxTotalNotionalUsdt ?? 0);

  return [{
    id: `${input.deploymentId}:${slug(symbol)}`,
    deploymentId: input.deploymentId,
    packageId: input.package.id,
    packageVersion: input.package.version,
    kind: "grid",
    symbol,
    params: {
      side: "long",
      lowerPrice,
      upperPrice,
      gridCount,
      sizePerGrid,
    },
    enabled: true,
    allocatedUsdt,
    botId: input.botId,
    tradingAccountId: input.tradingAccountId,
  }];
}
