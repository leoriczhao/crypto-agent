from __future__ import annotations

from typing import Any

from crypto_agent.agents.state import TraderGraphState


def build_trader_graph() -> Any:
    from langgraph.graph import END, START, StateGraph

    builder = StateGraph(TraderGraphState)
    builder.add_node("inspect_before", _inspect_before)
    builder.add_node("deploy_strategy", _deploy_strategy)
    builder.add_node("place_order", _place_order)
    builder.add_node("inspect_after", _inspect_after)
    builder.add_node("verify_outcome", _verify_outcome)
    builder.add_edge(START, "inspect_before")
    builder.add_edge("inspect_before", "deploy_strategy")
    builder.add_edge("deploy_strategy", "place_order")
    builder.add_edge("place_order", "inspect_after")
    builder.add_edge("inspect_after", "verify_outcome")
    builder.add_edge("verify_outcome", END)
    return builder.compile()


def _inspect_before(state: TraderGraphState) -> dict[str, Any]:
    return {"portfolio_before": _portfolio(state)}


def _place_order(state: TraderGraphState) -> dict[str, Any]:
    result = state["tool_registry"].dispatch(
        "open_position",
        {
            "trading_account_id": state["trading_account_id"],
            "bot_id": state["bot_id"],
            "symbol": state["symbol"],
            "side": state["side"],
            "position_side": state["position_side"],
            "quantity": state["quantity"],
            "leverage": state.get("leverage", 1),
            "mark_price": state["mark_price"],
        },
        state["deps"],
    )
    if not result["ok"]:
        raise RuntimeError(result["error"])
    return {"order_result": result["result"]}


def _deploy_strategy(state: TraderGraphState) -> dict[str, Any]:
    package_id = state.get("strategy_package_id")
    if not package_id:
        return {}

    result = state["tool_registry"].dispatch(
        "deploy_strategy",
        {
            "package_id": package_id,
            "trading_account_id": state["trading_account_id"],
            "allocated_capital": state.get("allocated_capital", 0),
            "mode": "paper",
        },
        state["deps"],
    )
    if not result["ok"]:
        raise RuntimeError(result["error"])
    return {"strategy_deployment_id": result["result"]["deployment_id"]}


def _inspect_after(state: TraderGraphState) -> dict[str, Any]:
    return {"portfolio_after": _portfolio(state)}


def _verify_outcome(state: TraderGraphState) -> dict[str, str]:
    if state["order_result"].get("status") == "filled":
        return {"outcome": "ordered"}
    if state["order_result"].get("allowed") is False:
        return {"outcome": "blocked_by_risk"}
    return {"outcome": "unknown"}


def _portfolio(state: TraderGraphState) -> dict[str, Any]:
    result = state["tool_registry"].dispatch(
        "get_portfolio",
        {
            "trading_account_id": state["trading_account_id"],
            "bot_id": state["bot_id"],
        },
        state["deps"],
    )
    if not result["ok"]:
        raise RuntimeError(result["error"])
    return result["result"]
