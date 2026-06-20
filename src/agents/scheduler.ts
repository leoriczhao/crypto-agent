import type { Memory, ResidentAgentRow } from "../memory.js";
import type { ResidentAgentRuntime } from "./runtime.js";

export interface ResidentAgentSchedulerRuntime {
  nextRunFor(agent: ResidentAgentRow, fromMs?: number): string | null;
  runAgent(agentId: string, trigger?: string): Promise<unknown>;
}

export interface RunDueResidentAgentsOptions {
  memory: Memory;
  runtime: ResidentAgentRuntime | ResidentAgentSchedulerRuntime;
  now?: string;
  log?: (message: string) => void;
}

export interface RunDueResidentAgentsResult {
  attempted: number;
  completed: number;
  failed: number;
}

export async function runDueResidentAgents(opts: RunDueResidentAgentsOptions): Promise<RunDueResidentAgentsResult> {
  const nowIso = opts.now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const dueAgents = opts.memory.getDueResidentAgents(nowIso);
  const result: RunDueResidentAgentsResult = { attempted: 0, completed: 0, failed: 0 };

  for (const agent of dueAgents) {
    result.attempted++;
    const nextRun = opts.runtime.nextRunFor(agent, Number.isFinite(nowMs) ? nowMs : Date.now())
      ?? new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + 60 * 60_000).toISOString();
    opts.memory.updateResidentAgentNextRun(agent.id, nextRun);

    try {
      await opts.runtime.runAgent(agent.id, "schedule");
      result.completed++;
    } catch (e: any) {
      result.failed++;
      opts.log?.(`[Resident agent error] ${agent.id}: ${e.message ?? e}`);
    }
  }

  return result;
}
