from .registry import register_tool


@register_tool(
    name="switch_soul",
    description="Switch trading personality. Options: conservative (保守), balanced (均衡), aggressive (激进). Shows current personality if none specified.",
    schema={
        "type": "object",
        "properties": {
            "personality": {"type": "string", "enum": ["conservative", "balanced", "aggressive"]},
        },
        "required": [],
    },
)
async def handle_switch_soul(soul, personality: str = "", **_) -> str:
    try:
        if not personality:
            profile = soul.profile
            souls = soul.list_souls()
            active = soul.soul_id

            lines = [
                f"Current Personality: {soul.name}",
                "=" * 40,
                f"Description:     {profile['description']}",
                f"Max Position:    {profile['max_position_pct']}% of portfolio",
                f"Stop-Loss:       {profile['stop_loss_pct']}%",
                f"Preferred:       {', '.join(profile['preferred_assets'])}",
                "",
                "Available Personalities:",
                "=" * 50,
            ]
            for s in souls:
                marker = " ← active" if s["id"] == active else ""
                lines.append(f"  • {s['name']}{marker}")
                lines.append(f"    {s['description']}")
            return "\n".join(lines)

        old_name = soul.name
        soul.switch(personality)
        profile = soul.profile
        lines = [
            f"Personality switched: {old_name} → {soul.name}",
            "=" * 40,
            f"Description:     {profile['description']}",
            f"Max Position:    {profile['max_position_pct']}% of portfolio",
            f"Stop-Loss:       {profile['stop_loss_pct']}%",
            f"Preferred:       {', '.join(profile['preferred_assets'])}",
        ]
        return "\n".join(lines)
    except ValueError as e:
        return f"Error: {e}"
    except Exception as e:
        return f"Error in switch_soul: {e}"
