from datetime import datetime, timedelta
from .registry import register_tool


@register_tool(
    name="schedule",
    description=(
        "Schedule recurring tasks.\n"
        "- Provide description + interval_minutes to CREATE a new task\n"
        "- Provide delete_id to DELETE a task\n"
        "- Call with no arguments to LIST all tasks"
    ),
    schema={
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "What the task should do (creates a new schedule)"},
            "interval_minutes": {"type": "integer", "description": "Run every N minutes", "default": 60},
            "delete_id": {"type": "integer", "description": "Job ID to delete"},
        },
    },
)
async def handle_schedule(memory, description: str = "", interval_minutes: int = 60, delete_id: int = 0, **_) -> str:
    try:
        if delete_id:
            memory.delete_cron_job(delete_id)
            return f"Deleted scheduled task #{delete_id}"

        if description:
            next_run = (datetime.now() + timedelta(minutes=interval_minutes)).isoformat()
            cron_expr = f"every_{interval_minutes}m"
            new_id = memory.add_cron_job(description, cron_expr, next_run)
            return f"Scheduled task #{new_id}: '{description}' every {interval_minutes} minutes. Next run: {next_run}"

        jobs = memory.list_cron_jobs()
        if not jobs:
            return "No scheduled tasks."
        lines = ["ID | Description | Interval | Next Run | Enabled"]
        lines.append("-" * 70)
        for j in jobs:
            lines.append(f"{j['id']} | {j['description'][:30]} | {j['cron_expr']} | {j['next_run'][:16]} | {'Yes' if j['enabled'] else 'No'}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {e}"
