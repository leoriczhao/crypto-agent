import asyncio
from anthropic import Anthropic
from .config import config
from .exchange.paper import PaperExchange
from .exchange.live import LiveExchange
from .tools.registry import TOOL_DEFINITIONS, TOOL_HANDLERS
from .tools import market_data, execute_trade, portfolio  # noqa: F401


SYSTEM = """You are a cryptocurrency trading assistant.
You have access to real-time market data and can execute trades (paper trading mode by default).

Capabilities:
- Check prices, charts, order books for any crypto pair
- Execute buy/sell orders (paper trading)
- Track portfolio, positions, and PnL

Always show prices with appropriate precision. When discussing trades, mention the current mode (PAPER/LIVE).
Be concise. Use tables for data when appropriate.
Symbols use format: BTC/USDT, ETH/USDT, SOL/USDT etc.
"""


class CryptoAgent:
    def __init__(self):
        self.client = Anthropic(base_url=config.anthropic_base_url or None)
        self.exchange = (
            PaperExchange(config.default_exchange, config.initial_balance)
            if config.paper_trading
            else LiveExchange(config.default_exchange)
        )
        self.messages: list = []

    async def _dispatch_tool(self, name: str, inputs: dict) -> str:
        handler = TOOL_HANDLERS.get(name)
        if not handler:
            return f"Unknown tool: {name}"
        if name == "execute_trade":
            return await handler(exchange=self.exchange, config=config, **inputs)
        return await handler(exchange=self.exchange, **inputs)

    async def chat(self, user_message: str) -> str:
        self.messages.append({"role": "user", "content": user_message})

        while True:
            response = self.client.messages.create(
                model=config.model_id,
                system=SYSTEM,
                messages=self.messages,
                tools=TOOL_DEFINITIONS,
                max_tokens=4096,
            )
            self.messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason != "tool_use":
                text_parts = [b.text for b in response.content if hasattr(b, "text")]
                return "\n".join(text_parts)

            results = []
            for block in response.content:
                if block.type == "tool_use":
                    output = await self._dispatch_tool(block.name, block.input)
                    results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": output,
                    })
            self.messages.append({"role": "user", "content": results})

    async def close(self):
        await self.exchange.close()
