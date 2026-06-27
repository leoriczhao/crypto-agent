from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any, Callable

from crypto_agent.tools.strategy_tools import create_strategy_package, deploy_strategy, validate_strategy
from crypto_agent.tools.trading_tools import get_portfolio, open_position

ToolHandler = Callable[[dict[str, Any], dict[str, Any]], Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, tuple[str, list[str], ToolHandler]] = {}

    def register(
        self,
        name: str,
        description: str,
        dependencies: list[str],
        handler: ToolHandler,
    ) -> None:
        self._tools[name] = (description, dependencies, handler)

    def dispatch(
        self,
        name: str,
        args: dict[str, Any],
        deps: dict[str, Any],
    ) -> dict[str, Any]:
        if name not in self._tools:
            return {"ok": False, "error": f"unknown tool: {name}", "tool": name}

        _description, dependencies, handler = self._tools[name]
        missing = [dependency for dependency in dependencies if dependency not in deps]
        if missing:
            return {
                "ok": False,
                "error": f"missing tool dependencies: {', '.join(missing)}",
                "tool": name,
            }

        try:
            result = handler(args, deps)
            return {"ok": True, "result": _serialize(result), "tool": name}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "tool": name}


def build_default_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register("get_portfolio", "Read allocation and paper positions", ["db_path"], get_portfolio)
    registry.register("open_position", "Open or close a paper/live position through OrderExecutor", ["order_executor"], open_position)
    registry.register(
        "create_strategy_package",
        "Create a draft signal strategy package",
        ["strategy_validation_service"],
        create_strategy_package,
    )
    registry.register(
        "validate_strategy",
        "Run backtest validation for a strategy package",
        ["strategy_validation_service"],
        validate_strategy,
    )
    registry.register(
        "deploy_strategy",
        "Deploy a passed strategy package to paper or live mode",
        ["strategy_validation_service"],
        deploy_strategy,
    )
    return registry


def _serialize(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    return value
