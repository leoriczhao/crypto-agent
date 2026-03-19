from .tools.registry import TOOL_DEFINITIONS, TOOL_HANDLERS

ROLES = {
    "researcher": {
        "system": (
            "You are a crypto market researcher. Your job is to gather and analyze information — "
            "market data, news sentiment, on-chain metrics, and technical indicators. "
            "Provide thorough analysis with data to support your conclusions. "
            "You do NOT execute trades. Present findings clearly with actionable insights."
        ),
        "tools": ["market_data", "news_feed", "chain_data", "strategy"],
    },
    "trader": {
        "system": (
            "You are a crypto trader. You analyze market conditions and execute trades. "
            "Always check current positions and risk before trading. "
            "Use technical analysis to time entries and exits. "
            "Report every trade with rationale, entry price, and target."
        ),
        "tools": ["market_data", "execute_trade", "portfolio", "strategy", "backtest"],
    },
    "risk_officer": {
        "system": (
            "You are a risk management officer. Your job is to evaluate portfolio risk, "
            "check position concentration, monitor drawdowns, and enforce risk limits. "
            "Flag any concerning exposures. You do NOT execute trades — you advise on risk. "
            "Be conservative and protective of capital."
        ),
        "tools": ["risk_check", "portfolio", "market_data"],
    },
}


class SubAgentRunner:
    def __init__(self, role: str):
        if role not in ROLES:
            raise ValueError(f"Unknown role: {role}. Available: {list(ROLES.keys())}")
        self.role = role
        self.config = ROLES[role]

    @property
    def system_prompt(self) -> str:
        return self.config["system"]

    @property
    def allowed_tools(self) -> list[str]:
        return self.config["tools"]

    def get_tool_definitions(self) -> list[dict]:
        return [t for t in TOOL_DEFINITIONS if t["name"] in self.allowed_tools]

    def get_tool_handlers(self) -> dict:
        return {k: v for k, v in TOOL_HANDLERS.items() if k in self.allowed_tools}
