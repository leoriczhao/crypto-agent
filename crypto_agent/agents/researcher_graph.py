from __future__ import annotations

from typing import Any

from crypto_agent.agents.state import ResearcherGraphState


def build_researcher_graph() -> Any:
    from langgraph.graph import END, START, StateGraph

    builder = StateGraph(ResearcherGraphState)
    builder.add_node("create_package", _create_package)
    builder.add_node("validate_package", _validate_package)
    builder.add_node("verify_outcome", _verify_outcome)
    builder.add_edge(START, "create_package")
    builder.add_edge("create_package", "validate_package")
    builder.add_edge("validate_package", "verify_outcome")
    builder.add_edge("verify_outcome", END)
    return builder.compile()


def _create_package(state: ResearcherGraphState) -> dict[str, Any]:
    result = state["tool_registry"].dispatch(
        "create_strategy_package",
        {
            "bot_id": state["bot_id"],
            "resident_agent_id": state.get("resident_agent_id"),
            "symbol": state["symbol"],
            "timeframe": state["timeframe"],
            "name": state["name"],
            "entry_conditions": state["entry_conditions"],
            "exit_conditions": state["exit_conditions"],
        },
        state["deps"],
    )
    if not result["ok"]:
        raise RuntimeError(result["error"])
    return {"package_id": result["result"]["package_id"]}


def _validate_package(state: ResearcherGraphState) -> dict[str, Any]:
    result = state["tool_registry"].dispatch(
        "validate_strategy",
        {
            "package_id": state["package_id"],
            "candles": state["candles"],
        },
        state["deps"],
    )
    if not result["ok"]:
        raise RuntimeError(result["error"])
    return {"validation": result["result"]}


def _verify_outcome(state: ResearcherGraphState) -> dict[str, str]:
    status = state["validation"]["status"]
    return {"outcome": "validated" if status == "passed" else "rejected"}
