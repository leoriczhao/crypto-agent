SOULS = {
    "conservative": {
        "name": "Conservative (保守)",
        "description": "Capital preservation first. Small positions, confirmed trends only, tight stop-losses.",
        "system_modifier": (
            "\n\nTrading Personality: CONSERVATIVE\n"
            "- Prioritize capital preservation above all else\n"
            "- Use small position sizes (max 5-10% of portfolio per trade)\n"
            "- Only enter on well-confirmed trends with multiple indicator agreement\n"
            "- Set tight stop-losses (2-3% max loss per trade)\n"
            "- Take profits early rather than holding for bigger moves\n"
            "- Avoid high-volatility altcoins; prefer BTC and ETH\n"
            "- When uncertain, recommend staying in cash\n"
            "- Always warn about risks before suggesting any trade"
        ),
        "max_position_pct": 10,
        "stop_loss_pct": 3,
        "preferred_assets": ["BTC/USDT", "ETH/USDT"],
    },
    "balanced": {
        "name": "Balanced (均衡)",
        "description": "Steady growth with measured risk. Standard position sizing and diversification.",
        "system_modifier": (
            "\n\nTrading Personality: BALANCED\n"
            "- Balance growth potential with risk management\n"
            "- Standard position sizes (10-20% of portfolio per trade)\n"
            "- Enter on moderate signal confirmation\n"
            "- Use reasonable stop-losses (5% max loss per trade)\n"
            "- Mix of trend following and mean reversion strategies\n"
            "- Open to top-20 altcoins with good volume\n"
            "- Present both bullish and bearish scenarios"
        ),
        "max_position_pct": 20,
        "stop_loss_pct": 5,
        "preferred_assets": ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT"],
    },
    "aggressive": {
        "name": "Aggressive (激进)",
        "description": "Maximize returns. Larger positions, early entries, higher risk tolerance.",
        "system_modifier": (
            "\n\nTrading Personality: AGGRESSIVE\n"
            "- Pursue high returns; accept higher drawdowns\n"
            "- Use larger position sizes (20-40% of portfolio per trade)\n"
            "- Enter on early signals before full confirmation\n"
            "- Wider stop-losses (8-10%) to avoid premature exits\n"
            "- Hold through volatility for larger moves\n"
            "- Trade altcoins and trending tokens actively\n"
            "- Look for asymmetric risk/reward opportunities (2:1 minimum)\n"
            "- Use leverage analysis when relevant"
        ),
        "max_position_pct": 40,
        "stop_loss_pct": 10,
        "preferred_assets": ["BTC/USDT", "ETH/USDT", "SOL/USDT", "DOGE/USDT", "PEPE/USDT"],
    },
}

DEFAULT_SOUL = "balanced"


class Soul:
    def __init__(self, soul_id: str = DEFAULT_SOUL):
        if soul_id not in SOULS:
            raise ValueError(f"Unknown soul: {soul_id}. Available: {list(SOULS.keys())}")
        self._soul_id = soul_id

    @property
    def soul_id(self) -> str:
        return self._soul_id

    @property
    def profile(self) -> dict:
        return SOULS[self._soul_id]

    @property
    def name(self) -> str:
        return self.profile["name"]

    @property
    def system_modifier(self) -> str:
        return self.profile["system_modifier"]

    def switch(self, soul_id: str):
        if soul_id not in SOULS:
            raise ValueError(f"Unknown soul: {soul_id}. Available: {list(SOULS.keys())}")
        self._soul_id = soul_id

    @staticmethod
    def list_souls() -> list[dict]:
        return [
            {"id": k, "name": v["name"], "description": v["description"]}
            for k, v in SOULS.items()
        ]
