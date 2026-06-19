import { registerTool } from "./registry.js";
import { resolveToolTradingContext } from "./trading-context.js";

registerTool(
  "llm_trader_job",
  "Manage scheduled LLM trader jobs bound to the active bot. Actions: create, list, disable, enable, delete.",
  {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "disable", "enable", "delete"], default: "list" },
      id: { type: "integer", description: "Job id for disable/enable/delete" },
      prompt: { type: "string", description: "Prompt executed on each schedule for create" },
      interval_minutes: { type: "integer", default: 60 },
    },
  },
  ["memory", "sessionId"],
  async ({ memory, sessionId, action = "list", id = 0, prompt = "", interval_minutes = 60 }) => {
    try {
      if (!memory) return "Error: memory is not initialized";

      if (action === "create") {
        if (!prompt.trim()) return "Error: prompt is required";
        const ctx = resolveToolTradingContext(memory, sessionId);
        const nextRun = new Date(Date.now() + interval_minutes * 60_000).toISOString();
        const cronJobId = memory.addCronJob(`LLM trader: ${prompt.slice(0, 80)}`, `every_${interval_minutes}m`, nextRun);
        const jobSessionId = `llm-trader-${cronJobId}`;
        memory.createSession(jobSessionId, `LLM trader #${cronJobId}`, "system", ctx.botId);
        const jobId = memory.createLlmTraderJob({
          cronJobId,
          botId: ctx.botId,
          tradingAccountId: ctx.tradingAccountId,
          sessionId: jobSessionId,
          prompt,
        });
        return `LLM trader job created #${jobId} (cron #${cronJobId}) every ${interval_minutes} minutes.`;
      }

      if (action === "disable") {
        if (!id) return "Error: id is required";
        memory.setLlmTraderJobEnabled(Number(id), false);
        return `LLM trader job #${id} disabled.`;
      }

      if (action === "enable") {
        if (!id) return "Error: id is required";
        memory.setLlmTraderJobEnabled(Number(id), true);
        return `LLM trader job #${id} enabled.`;
      }

      if (action === "delete") {
        if (!id) return "Error: id is required";
        memory.deleteLlmTraderJob(Number(id));
        return `LLM trader job #${id} deleted.`;
      }

      const jobs = memory.listLlmTraderJobs();
      if (!jobs.length) return "No LLM trader jobs.";
      const lines = ["LLM Trader Jobs:", "ID | Status | Cron | Bot | Prompt", "-".repeat(80)];
      for (const job of jobs) {
        const status = job.enabled ? "ON " : "OFF";
        lines.push(`#${job.id} | ${status} | cron #${job.cronJobId} | ${job.botId} | ${job.prompt.slice(0, 60)}`);
      }
      return lines.join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
