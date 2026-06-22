import type {
  Memory,
  StrategyDeploymentMode,
  StrategyDeploymentRow,
  StrategyInstanceRow,
} from "../memory.js";
import type { Strategy } from "./base.js";
import type { StrategyManager } from "./manager.js";
import { assertPackageDeployable, compileStrategyPackage } from "./package-compiler.js";
import type { CompiledStrategyInstanceInput } from "./package-types.js";

export interface DeploymentRuntime {
  startOne(strategy: Strategy): void;
  stopOne(id: string): Promise<void>;
}

export interface StrategyDeploymentServiceOptions {
  memory: Memory;
  manager: StrategyManager;
  runtime?: DeploymentRuntime | null;
}

export interface ActivateStrategyDeploymentInput {
  id?: string;
  packageId: string;
  packageVersion: number;
  mode: StrategyDeploymentMode;
  tradingAccountId: string;
  botId: string;
  capitalAllocationId: string;
  residentTraderId?: string | null;
  runtimePolicy?: Record<string, any>;
  allocatedUsdt?: number;
}

export interface StrategyDeploymentActivationResult {
  deployment: StrategyDeploymentRow;
  instances: StrategyInstanceRow[];
}

export class StrategyDeploymentService {
  private memory: Memory;
  private manager: StrategyManager;
  private runtime: DeploymentRuntime | null;

  constructor(opts: StrategyDeploymentServiceOptions) {
    this.memory = opts.memory;
    this.manager = opts.manager;
    this.runtime = opts.runtime ?? null;
  }

  setRuntime(runtime: DeploymentRuntime | null): void {
    this.runtime = runtime;
  }

  async activate(input: ActivateStrategyDeploymentInput): Promise<StrategyDeploymentActivationResult> {
    const pkg = this.memory.getStrategyPackage(input.packageId, input.packageVersion);
    if (!pkg) throw new Error(`Strategy package not found: ${input.packageId}@${input.packageVersion}`);
    assertPackageDeployable(pkg, input.mode);

    const deployment = this.memory.createStrategyDeployment({
      id: input.id,
      packageId: input.packageId,
      packageVersion: input.packageVersion,
      status: "proposed",
      mode: input.mode,
      tradingAccountId: input.tradingAccountId,
      botId: input.botId,
      capitalAllocationId: input.capitalAllocationId,
      residentTraderId: input.residentTraderId ?? null,
      runtimePolicy: input.runtimePolicy ?? {},
    });

    const compiled = compileStrategyPackage({
      package: pkg,
      deploymentId: deployment.id,
      botId: input.botId,
      tradingAccountId: input.tradingAccountId,
      allocatedUsdt: input.allocatedUsdt,
    });
    const instances = compiled.map((instance) => this.persistAndStartInstance(instance));
    this.memory.updateStrategyDeployment(deployment.id, {
      status: "active",
      startedAt: new Date().toISOString(),
    });

    return {
      deployment: this.memory.getStrategyDeployment(deployment.id)!,
      instances,
    };
  }

  async pause(deploymentId: string): Promise<void> {
    await this.setDeploymentRunningState(deploymentId, false);
    this.memory.updateStrategyDeployment(deploymentId, { status: "paused" });
  }

  async resume(deploymentId: string): Promise<void> {
    const deployment = this.requireDeployment(deploymentId);
    const instances = this.memory.listStrategyInstances(deployment.id);
    for (const instance of instances) {
      this.memory.updateStrategyInstance(instance.id, { enabled: true });
      const strategy = this.manager.updateStrategy(instance.id, { enabled: true }, { persist: false })
        ?? this.materializeInstance({ ...instance, enabled: true });
      this.runtime?.startOne(strategy);
    }
    this.memory.updateStrategyDeployment(deployment.id, { status: "active" });
  }

  async stop(deploymentId: string): Promise<void> {
    await this.setDeploymentRunningState(deploymentId, false);
    this.memory.updateStrategyDeployment(deploymentId, {
      status: "stopped",
      stoppedAt: new Date().toISOString(),
    });
  }

  startActiveDeployments(): void {
    for (const deployment of this.memory.listStrategyDeployments({ status: "active" })) {
      for (const instance of this.memory.listStrategyInstances(deployment.id).filter((i) => i.enabled)) {
        const strategy = this.manager.getStrategy(instance.id) ?? this.materializeInstance(instance);
        this.runtime?.startOne(strategy);
      }
    }
  }

  private async setDeploymentRunningState(deploymentId: string, enabled: boolean): Promise<void> {
    const deployment = this.requireDeployment(deploymentId);
    const instances = this.memory.listStrategyInstances(deployment.id);
    for (const instance of instances) {
      this.memory.updateStrategyInstance(instance.id, { enabled });
      const strategy = this.manager.updateStrategy(instance.id, { enabled }, { persist: false });
      if (!enabled) await this.runtime?.stopOne(instance.id);
      else if (strategy) this.runtime?.startOne(strategy);
    }
  }

  private requireDeployment(deploymentId: string): StrategyDeploymentRow {
    const deployment = this.memory.getStrategyDeployment(deploymentId);
    if (!deployment) throw new Error(`Strategy deployment not found: ${deploymentId}`);
    return deployment;
  }

  private persistAndStartInstance(instance: CompiledStrategyInstanceInput): StrategyInstanceRow {
    const row = this.memory.createStrategyInstance(instance);
    const strategy = this.materializeInstance(row);
    if (row.enabled) this.runtime?.startOne(strategy);
    return row;
  }

  private materializeInstance(instance: StrategyInstanceRow): Strategy {
    return this.manager.addStrategy({
      id: instance.id,
      kind: instance.kind,
      symbol: instance.symbol,
      params: instance.params,
      allocatedUsdt: instance.allocatedUsdt,
      enabled: instance.enabled,
      botId: instance.botId,
      tradingAccountId: instance.tradingAccountId,
    }, { persist: false });
  }
}
