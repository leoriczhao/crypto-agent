import type { CryptoAgent } from "../agent.js";
import type {
  AgentMandateAssignmentRow,
  AgentRunRow,
  Memory,
  ResidentAgentRow,
  StrategyMandateRow,
} from "../memory.js";

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
      "Execute only assigned active strategy mandates.",
      "Operate only inside the assigned capital allocation and risk policy.",
      "Use contract trading tools only when the mandate, evidence, and risk policy all permit it.",
      "Do not create schedules, spawn agents, or modify your own policy.",
      "Choose exactly one final action category for this run: open, close, adjust, hold.",
      "If the edge is unclear or the mandate is not satisfied, hold is the correct action.",
    ].join("\n");
  }
  if (agent.type === "researcher") {
    return [
      "You are a Resident Research Agent.",
      "Research assigned markets and produce concise findings for future trader runs.",
      "You do not place orders.",
      "If you propose a strategy mandate, mark it as a draft idea requiring later validation.",
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
  if (!mandates.length) return "No assigned strategy mandates.";
  return mandates.map(({ mandate, assignment }) => [
    `- ${mandate.id} v${mandate.version} (${mandate.status}, validation=${mandate.validationStatus})`,
    `  name: ${mandate.name}`,
    `  universe: ${assignment.universe.length ? assignment.universe.join(", ") : "not specified"}`,
    `  description: ${mandate.description || "n/a"}`,
    `  body: ${JSON.stringify(mandate.body)}`,
  ].join("\n")).join("\n");
}

function buildRunPrompt(opts: {
  agent: ResidentAgentRow;
  trigger: string;
  mandates: Array<{ mandate: StrategyMandateRow; assignment: AgentMandateAssignmentRow }>;
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
    "## Assigned Strategy Mandates",
    formatMandates(opts.mandates),
    "",
    "## Run Instructions",
    "First inspect current portfolio, positions, and risk. Then inspect market data required by the assigned mandates.",
    "For each assigned mandate, decide whether its setup is satisfied.",
    "Only trade when the assigned mandate and risk policy both permit it.",
    "End with a concise run report: observations, mandate decision, final action, risk state, and tool results.",
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
    if (resident.type === "trader" && mandates.length === 0) {
      throw new Error(`Trader resident agent ${agentId} has no active assigned strategy mandate.`);
    }

    this.ensureSessionLoaded(resident);
    const prompt = buildRunPrompt({ agent: resident, trigger, mandates });
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

  private ensureSessionLoaded(agent: ResidentAgentRow): void {
    if (!this.agent.sessions.has(agent.sessionId)) {
      const session = this.agent.sessions.create(agent.name, "system", agent.sessionId);
      const messages = this.memory.loadRecentMessages(agent.sessionId, this.loadRecentMessages);
      if (messages.length) session.messages = messages;
    }
  }
}
