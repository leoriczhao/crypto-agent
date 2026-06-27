from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RiskDecision:
    allowed: bool
    rule: str
    reason: str


ALLOW = RiskDecision(allowed=True, rule="allowed", reason="Order passed risk checks")
