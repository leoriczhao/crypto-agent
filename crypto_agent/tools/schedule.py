from datetime import datetime, timedelta
from .registry import register_tool


@register_tool(
    name="schedule",
    description=(
        "Manage scheduled tasks. The agent can schedule future actions.\n"
        "- create: schedule a new task (e.g. 'check BTC RSI every 4 hours')\n"
        "- list: show all scheduled tasks\n"
        "- delete: remove a scheduled task by ID"
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["create", "list", "delete"]},
            "description": {"type": "string", "description": "What the task should do"},
            "interval_minutes": {"type": "integer", "description": "Run every N minutes"},
            "job_id": {"type": "integer", "description": "Job ID for delete action"},
        },
        "required": ["action"],
    },
)
async def handle_schedule(memory, action: str, description: str = "", interval_minutes: int = 60, job_id: int = 0, **_) -> str:
    try:
        if action == "create":
            if not description:
                return "Error: description is required"
            next_run = (datetime.now() + timedelta(minutes=interval_minutes)).isoformat()
            cron_expr = f"every_{interval_minutes}m"
            new_id = memory.add_cron_job(description, cron_expr, next_run)
            return f"Scheduled task #{new_id}: '{description}' every {interval_minutes} minutes. Next run: {next_run}"

        elif action == "list":
            jobs = memory.list_cron_jobs()
            if not jobs:
                return "No scheduled tasks."
            lines = ["ID | Description | Interval | Next Run | Enabled"]
            lines.append("-" * 70)
            for j in jobs:
                lines.append(f"{j['id']} | {j['description'][:30]} | {j['cron_expr']} | {j['next_run'][:16]} | {'Yes' if j['enabled'] else 'No'}")
            return "\n".join(lines)

        elif action == "delete":
            if not job_id:
                return "Error: job_id is required"
            memory.delete_cron_job(job_id)
            return f"Deleted scheduled task #{job_id}"

        return f"Unknown action: {action}"
    except Exception as e:
        return f"Error: {e}"
