import type { CryptoAgent } from "../agent.js";
import type {
  AgentMandateAssignmentRow,
  AgentRunRow,
  Memory,
  ResidentAgentRow,
  StrategyDeploymentRow,
  StrategyMandateRow,
  StrategyPackageRow,
} from "../memory.js";
import { collectDeploymentHealth, renderDeploymentHealthCompact } from "../strategy/deployment-health.js";

export interface ResidentAgentRuntimeOptions {
  memory: Memory;
  agent: CryptoAgent;
  loadRecentMessages?: number;
}

export interface ResidentAgentRunResult {
  run: AgentRunRow;
  response: string;
}

function parseIntervalMinutes(expr: string | null): number | null {
  const match = expr?.match(/^every_(\d+)m$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  return minutes > 0 ? minutes : null;
}

export function nextRunFromSchedule(expr: string | null, fromMs = Date.now()): string | null {
  const minutes = parseIntervalMinutes(expr);
  if (!minutes) return null;
  return new Date(fromMs + minutes * 60_000).toISOString();
}

function roleContract(agent: ResidentAgentRow): string {
  if (agent.type === "trader") {
    return [
      "You are a Resident Trader Agent.",
      "Supervise strategy package deployments owned by your bot and capital allocation.",
      "Operate only inside the assigned capital allocation and risk policy.",
      "Activate only packages whose status, validation evidence, and risk policy permit the target mode.",
      "Use deploy_strategy to activate, pause, resume, stop, or inspect deterministic runtime deployments.",
      "Do not create schedules, spawn agents, or modify your own policy.",
      "Choose exactly one final action category for this run: activate, pause, stop, revise_request, or hold.",
      "If the edge is unclear, validation is weak, or risk is outside policy, hold or pause is the correct action.",
    ].join("\n");
  }
  if (agent.type === "researcher") {
    return [
      "You are a Resident Research Agent.",
      "Research assigned markets and produce concise findings for future trader runs.",
      "You do not place orders.",
      "If you propose a strategy, create a strategy package draft or submitted package requiring validation.",
    ].join("\n");
  }
  return [
    `You are a Resident ${agent.type} Agent.`,
    "Follow your mandate, tool policy, and runtime constraints.",
  ].join("\n");
}

function formatMandates(
  mandates: Array<{ mandate: StrategyMandateRow; assignment: AgentMandateAssignmentRow }>,
): string {
  if (!mandates.length) return "No legacy strategy mandates assigned.";
  return mandates.map(({ mandate, assignment }) => [
    `- ${mandate.id} v${mandate.version} (${mandate.status}, validation=${mandate.validationStatus})`,
    `  name: ${mandate.name}`,
    `  universe: ${assignment.universe.length ? assignment.universe.join(", ") : "not specified"}`,
    `  description: ${mandate.description || "n/a"}`,
    `  body: ${JSON.stringify(mandate.body)}`,
  ].join("\n")).join("\n");
}

function clip(value: string, max = 180): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function formatStrategyPackages(packages: StrategyPackageRow[]): string {
  if (!packages.length) return "No strategy packages exist yet.";
  return packages.slice(0, 20).map((pkg) => [
    `- ${pkg.id}@${pkg.version} (${pkg.status}, validation=${pkg.validationStatus})`,
    `  name: ${pkg.name}`,
    `  source: ${pkg.source}`,
    `  summary: ${clip(typeof pkg.mandate === "string" ? pkg.mandate : JSON.stringify(pkg.mandate))}`,
    `  risk_policy: ${JSON.stringify(pkg.riskPolicy)}`,
  ].join("\n")).join("\n");
}

function formatDeployments(memory: Memory, deployments: StrategyDeploymentRow[]): string {
  if (!deployments.length) return "No deployments currently associated with this resident trader or bot.";
  return deployments.map((deployment) => {
    const instances = memory.listStrategyInstances(deployment.id);
    const lines = [
      `- ${deployment.id} (${deployment.status}, ${deployment.mode})`,
      `  package: ${deployment.packageId}@${deployment.packageVersion}`,
      `  bot: ${deployment.botId}`,
      `  trading_account: ${deployment.tradingAccountId}`,
      `  allocation: ${deployment.capitalAllocationId}`,
      `  resident_trader: ${deployment.residentTraderId ?? "n/a"}`,
    ];
    if (deployment.mode === "PAPER") {
      lines.push(...renderDeploymentHealthCompact(collectDeploymentHealth(memory, deployment, instances)));
    }
    return lines.join("\n");
  }).join("\n");
}

function runInstructions(agent: ResidentAgentRow): string[] {
  if (agent.type === "trader") {
    return [
      "Inspect current portfolio, positions, deployments, validation evidence, and risk state.",
      "For an undeployed package, use deploy_strategy only when package status and validation allow the target mode.",
      "For an active deployment, decide whether to hold, pause, resume, stop, or request a package revision.",
      "Do not improvise a new trade outside the package/deployment/risk-policy boundary.",
      "End with a concise run report: observations, deployment decision, final action, risk state, and tool results.",
    ];
  }
  if (agent.type === "researcher") {
    return [
      "Inspect market context, prior package outcomes, and research KB before proposing changes.",
      "Create strategy packages for reusable strategy logic; do not place orders.",
      "End with concise findings, rejected hypotheses, package changes, and validation needs.",
    ];
  }
  return [
    "Follow your mandate, inspect relevant state, and end with a concise run report.",
  ];
}

function buildRunPrompt(opts: {
  agent: ResidentAgentRow;
  trigger: string;
  mandates: Array<{ mandate: StrategyMandateRow; assignment: AgentMandateAssignmentRow }>;
  packages: StrategyPackageRow[];
  deployments: StrategyDeploymentRow[];
  memory: Memory;
}): string {
  return [
    `[RESIDENT_AGENT_RUN trigger=${opts.trigger}]`,
    "",
    "## Role Contract",
    roleContract(opts.agent),
    "",
    "## Agent Profile",
    `id: ${opts.agent.id}`,
    `name: ${opts.agent.name}`,
    `type: ${opts.agent.type}`,
    `bot_id: ${opts.agent.botId}`,
    `trading_account_id: ${opts.agent.tradingAccountId}`,
    `capital_allocation_id: ${opts.agent.capitalAllocationId ?? "n/a"}`,
    `tool_policy: ${opts.agent.toolPolicy}`,
    `risk_policy: ${JSON.stringify(opts.agent.riskPolicy)}`,
    "",
    "## Long-Term Mandate",
    opts.agent.mandate || "Follow assigned mandates and report clearly.",
    "",
    "## Strategy Package Context",
    formatStrategyPackages(opts.packages),
    "",
    "## Active Deployments",
    formatDeployments(opts.memory, opts.deployments),
    "",
    "## Legacy Strategy Mandates",
    formatMandates(opts.mandates),
    "",
    "## Run Instructions",
    ...runInstructions(opts.agent),
  ].join("\n");
}

export class ResidentAgentRuntime {
  private memory: Memory;
  private agent: CryptoAgent;
  private loadRecentMessages: number;

  constructor(opts: ResidentAgentRuntimeOptions) {
    this.memory = opts.memory;
    this.agent = opts.agent;
    this.loadRecentMessages = opts.loadRecentMessages ?? 20;
  }

  async runAgent(agentId: string, trigger = "manual"): Promise<ResidentAgentRunResult> {
    const resident = this.memory.getResidentAgent(agentId);
    if (!resident) throw new Error(`Resident agent not found: ${agentId}`);
    if (resident.status !== "active") throw new Error(`Resident agent is not active: ${agentId}`);

    const mandates = this.loadAssignedMandates(resident);
    const packages = this.memory.listStrategyPackages();
    const deployments = this.loadRelevantDeployments(resident);

    this.ensureSessionLoaded(resident);
    const prompt = buildRunPrompt({ agent: resident, trigger, mandates, packages, deployments, memory: this.memory });
    const run = this.memory.createAgentRun({
      agentId,
      trigger,
      input: prompt,
      mandateIds: mandates.map((m) => m.mandate.id),
    });

    this.memory.logAgentEvent({ agentId, runId: run.id, type: "run_started", payload: { trigger } });
    this.memory.saveMessage(resident.sessionId, "user", prompt);

    try {
      const response = await this.agent.chatInSession(resident.sessionId, prompt);
      this.memory.saveMessage(resident.sessionId, "assistant", response);
      this.memory.finishAgentRun(run.id, { status: "completed", summary: response.slice(0, 2000) });
      this.memory.logAgentEvent({ agentId, runId: run.id, type: "run_completed" });
      return { run: this.memory.getAgentRun(run.id)!, response };
    } catch (e: any) {
      const message = e?.message ?? String(e);
      this.memory.finishAgentRun(run.id, { status: "failed", error: message });
      this.memory.logAgentEvent({ agentId, runId: run.id, type: "run_failed", payload: { error: message } });
      throw e;
    }
  }

  nextRunFor(agent: ResidentAgentRow, fromMs = Date.now()): string | null {
    return nextRunFromSchedule(agent.scheduleExpr, fromMs);
  }

  private loadAssignedMandates(
    agent: ResidentAgentRow,
  ): Array<{ mandate: StrategyMandateRow; assignment: AgentMandateAssignmentRow }> {
    const assignments = this.memory.listAgentMandateAssignments(agent.id, { activeOnly: true });
    const result = [];
    for (const assignment of assignments) {
      const mandate = this.memory.getStrategyMandate(assignment.mandateId);
      if (!mandate || mandate.status !== "active") continue;
      result.push({ mandate, assignment });
    }
    return result;
  }

  private loadRelevantDeployments(agent: ResidentAgentRow): StrategyDeploymentRow[] {
    return this.memory
      .listStrategyDeployments()
      .filter((deployment) => deployment.residentTraderId === agent.id || deployment.botId === agent.botId);
  }

  private ensureSessionLoaded(agent: ResidentAgentRow): void {
    if (!this.agent.sessions.has(agent.sessionId)) {
      const session = this.agent.sessions.create(agent.name, "system", agent.sessionId);
      const messages = this.memory.loadRecentMessages(agent.sessionId, this.loadRecentMessages);
      if (messages.length) session.messages = messages;
    }
  }
}
