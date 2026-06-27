from __future__ import annotations

from typing import Any

from crypto_agent.domain.orders import OrderRequest
from crypto_agent.domain.risk import RiskDecision
from crypto_agent.trading.risk_gate import RiskGate


class OrderExecutor:
    def __init__(self, *, risk_gate: RiskGate, broker: Any):
        self.risk_gate = risk_gate
        self.broker = broker

    def execute_market_order(self, request: OrderRequest, *, mark_price: float) -> Any:
        decision = self.risk_gate.check_order(request, mark_price=mark_price)
        if not decision.allowed:
            return decision

        result = self.broker.create_market_order(request, mark_price=mark_price)
        return result
