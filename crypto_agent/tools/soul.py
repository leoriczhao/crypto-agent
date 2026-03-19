from .registry import register_tool


@register_tool(
    name="soul",
    description=(
        "Manage the agent's trading personality (soul).\n"
        "- status: show current trading personality\n"
        "- switch: change to a different personality\n"
        "- list: show all available personalities\n"
        "Personalities: conservative (保守), balanced (均衡), aggressive (激进)"
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["status", "switch", "list"]},
            "personality": {
                "type": "string",
                "enum": ["conservative", "balanced", "aggressive"],
                "description": "Personality to switch to (for switch action)",
            },
        },
        "required": ["action"],
    },
)
async def handle_soul(soul, action: str, personality: str = "", **_) -> str:
    try:
        if action == "status":
            profile = soul.profile
            lines = [
                f"Current Personality: {soul.name}",
                "=" * 40,
                f"Description:     {profile['description']}",
                f"Max Position:    {profile['max_position_pct']}% of portfolio",
                f"Stop-Loss:       {profile['stop_loss_pct']}%",
                f"Preferred:       {', '.join(profile['preferred_assets'])}",
            ]
            return "\n".join(lines)

        elif action == "switch":
            if not personality:
                return "Error: personality is required for switch action"
            old_name = soul.name
            soul.switch(personality)
            return f"Personality switched: {old_name} → {soul.name}"

        elif action == "list":
            souls = soul.list_souls()
            active = soul.soul_id
            lines = ["Available Personalities:", "=" * 50]
            for s in souls:
                marker = " ← active" if s["id"] == active else ""
                lines.append(f"  • {s['name']}{marker}")
                lines.append(f"    {s['description']}")
            return "\n".join(lines)

        return f"Unknown action: {action}"
    except ValueError as e:
        return f"Error: {e}"
    except Exception as e:
        return f"Error in soul: {e}"
