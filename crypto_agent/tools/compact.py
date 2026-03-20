from .registry import register_tool


@register_tool(
    name="compact",
    description=(
        "Compress conversation history to free up context space.\n"
        "Use when the conversation is getting long and you need more room.\n"
        "Saves full transcript to .transcripts/ before compressing."
    ),
    schema={
        "type": "object",
        "properties": {},
    },
)
async def handle_compact(agent, **_) -> str:
    from ..context import auto_compact, estimate_tokens

    before = estimate_tokens(agent.messages)
    agent.messages = auto_compact(
        agent.messages,
        agent.client,
        agent.provider,
        force=True,
    )
    after = estimate_tokens(agent.messages)
    return f"Context compacted: {before:,} → {after:,} tokens (saved {before - after:,})"
