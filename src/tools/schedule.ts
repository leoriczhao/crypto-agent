import { registerTool } from "./registry.js";

registerTool(
  "schedule",
  "Schedule recurring tasks.\n- Provide description + interval_minutes to CREATE a new task\n- Provide delete_id to DELETE a task\n- Call with no arguments to LIST all tasks",
  {
    type: "object",
    properties: {
      description: { type: "string", description: "What the task should do (creates a new schedule)" },
      interval_minutes: { type: "integer", description: "Run every N minutes", default: 60 },
      delete_id: { type: "integer", description: "Job ID to delete" },
    },
  },
  async ({ memory, description = "", interval_minutes = 60, delete_id = 0 }) => {
    try {
      if (delete_id) {
        memory.deleteCronJob(delete_id);
        return `Deleted scheduled task #${delete_id}`;
      }

      if (description) {
        const nextRun = new Date(Date.now() + interval_minutes * 60_000).toISOString();
        const cronExpr = `every_${interval_minutes}m`;
        const newId = memory.addCronJob(description, cronExpr, nextRun);
        return `Scheduled task #${newId}: '${description}' every ${interval_minutes} minutes. Next run: ${nextRun}`;
      }

      const jobs = memory.listCronJobs();
      if (!jobs.length) return "No scheduled tasks.";
      const lines = ["ID | Description | Interval | Next Run | Enabled", "-".repeat(70)];
      for (const j of jobs) {
        lines.push(
          `${j.id} | ${j.description.slice(0, 30)} | ${j.cron_expr} | ${j.next_run.slice(0, 16)} | ${j.enabled ? "Yes" : "No"}`,
        );
      }
      return lines.join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
