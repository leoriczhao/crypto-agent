from .registry import register_tool


@register_tool(
    name="load_skill",
    description=(
        "Load specialized trading knowledge on demand.\n"
        "Skills contain detailed domain expertise (strategy rules, exchange docs, risk limits).\n"
        "Always load the relevant skill before tackling unfamiliar topics."
    ),
    schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Skill name to load (see available skills in system prompt)",
            },
        },
        "required": ["name"],
    },
)
async def handle_load_skill(skill_loader, name: str, **_) -> str:
    return skill_loader.get_content(name)
