import type {
  StrategyDeploymentMode,
  StrategyPackageRow,
  StrategyPackageStatus,
  StrategyPackageValidationStatus,
} from "../memory.js";
import type { Condition } from "./state.js";

export interface SignalExecutableSpec {
  kind: "signal";
  symbols: string[];
  timeframe: string;
  side: "long" | "short";
  entry: Condition[];
  exit: Condition[];
  positionSizeUsdt: number;
  leverage?: number;
  stopLossPct: number;
  takeProfitPct: number;
}

export interface GridExecutableSpec {
  kind: "grid";
  symbol?: string;
  symbols?: string[];
  side: "long";
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  sizePerGrid: number;
}

export interface LadderExecutableSpec {
  kind: "ladder";
  symbol: string;
  [key: string]: any;
}

export type StrategyExecutableSpec = SignalExecutableSpec | GridExecutableSpec | LadderExecutableSpec;

export interface CompiledStrategyInstanceInput {
  id: string;
  deploymentId: string;
  packageId: string;
  packageVersion: number;
  kind: string;
  symbol: string;
  params: Record<string, any>;
  enabled: boolean;
  allocatedUsdt: number;
  botId: string;
  tradingAccountId: string;
}

export interface CompileStrategyPackageInput {
  package: StrategyPackageRow;
  deploymentId: string;
  botId: string;
  tradingAccountId: string;
  allocatedUsdt?: number;
}

export interface DeploymentPolicyInput {
  status: StrategyPackageStatus;
  validationStatus: StrategyPackageValidationStatus;
}

export type StrategyPackageDeployMode = StrategyDeploymentMode;
