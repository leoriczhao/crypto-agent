import json
from .registry import register_tool


@register_tool(
    name="delegate",
    description=(
        "Delegate a task to a specialized sub-agent.\n"
        "Roles:\n"
        "- researcher: market analysis, news, on-chain data, technical indicators (read-only)\n"
        "- trader: executes trades, uses strategy and portfolio tools\n"
        "- risk_officer: evaluates portfolio risk, concentration, drawdowns (advisory)\n\n"
        "The sub-agent will run autonomously with its specialized tools and return a report."
    ),
    schema={
        "type": "object",
        "properties": {
            "role": {
                "type": "string",
                "enum": ["researcher", "trader", "risk_officer"],
            },
            "task": {
                "type": "string",
                "description": "Detailed description of what the sub-agent should do",
            },
        },
        "required": ["role", "task"],
    },
)
async def handle_delegate(agent, role: str, task: str, **_) -> str:
    try:
        from ..sub_agents import SubAgentRunner
        runner = SubAgentRunner(role)
        result = await _run_sub_agent(agent, runner, task)
        return f"[{role.upper()}] {result}"
    except Exception as e:
        return f"Delegation error: {e}"


async def _run_sub_agent(agent, runner, task: str) -> str:
    sub_messages = [{"role": "user", "content": task}]

    if agent.provider == "openai":
        return await _run_openai(agent, runner, sub_messages)
    return await _run_anthropic(agent, runner, sub_messages)


async def _dispatch_sub_tool(agent, handler_name: str, handlers: dict, args: dict) -> str:
    handler = handlers.get(handler_name)
    if not handler:
        return f"Tool {handler_name} not available for this role"
    from ..config import config
    if handler_name in ("buy", "sell", "assess_risk"):
        return await handler(exchange=agent.exchange, config=config, **args)
    return await handler(exchange=agent.exchange, **args)


async def _run_openai(agent, runner, messages) -> str:
    from ..config import config
    from ..llm.provider import openai_sub_agent_kwargs
    tool_defs = runner.get_tool_definitions()
    handlers = runner.get_tool_handlers()
    tools = [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in tool_defs
    ] if tool_defs else None

    sub_kw = openai_sub_agent_kwargs(config)
    for _ in range(5):
        response = agent.client.chat.completions.create(
            messages=[{"role": "system", "content": runner.system_prompt}] + messages,
            tools=tools,
            **sub_kw,
        )
        msg = response.choices[0].message

        if not msg.tool_calls:
            return msg.content or "(no response)"

        messages.append({
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in msg.tool_calls
            ],
        })

        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments)
            output = await _dispatch_sub_tool(agent, tc.function.name, handlers, args)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": output})

    return "(sub-agent reached max turns)"


async def _run_anthropic(agent, runner, messages) -> str:
    from ..config import config
    from ..llm.provider import anthropic_sub_agent_kwargs
    tool_defs = runner.get_tool_definitions()
    handlers = runner.get_tool_handlers()

    sub_kw = anthropic_sub_agent_kwargs(config)
    for _ in range(5):
        response = agent.client.messages.create(
            system=runner.system_prompt,
            messages=messages,
            tools=tool_defs if tool_defs else [],
            **sub_kw,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            return "\n".join(b.text for b in response.content if hasattr(b, "text"))

        results = []
        for block in response.content:
            if block.type == "tool_use":
                output = await _dispatch_sub_tool(agent, block.name, handlers, block.input)
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
        messages.append({"role": "user", "content": results})

    return "(sub-agent reached max turns)"
