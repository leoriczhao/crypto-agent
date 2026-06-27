from __future__ import annotations

from typing import Any

from crypto_agent.agents.state import MainGraphState


def build_main_graph() -> Any:
    from langgraph.graph import END, START, StateGraph

    builder = StateGraph(MainGraphState)
    builder.add_node("respond", _respond)
    builder.add_edge(START, "respond")
    builder.add_edge("respond", END)
    return builder.compile()


def _respond(state: MainGraphState) -> dict[str, str]:
    return {"response": state.get("message", "")}
