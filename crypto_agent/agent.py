import json
from .config import config
from .exchange.paper import PaperExchange
from .exchange.live import LiveExchange
from .exchange.manager import ExchangeManager
from .tools.registry import TOOL_DEFINITIONS, TOOL_HANDLERS
from .tools import market_data, execute_trade, portfolio, news_feed, strategy, risk_check, exchange_manage  # noqa: F401


SYSTEM = """You are a cryptocurrency trading assistant.
You have access to real-time market data and can execute trades (paper trading mode by default).

Capabilities:
- Check prices, charts, order books for any crypto pair
- Execute buy/sell orders (paper trading)
- Track portfolio, positions, and PnL
- Fetch crypto news headlines and sentiment analysis
- Technical analysis with SMA, RSI, Bollinger Bands and trading signals
- Portfolio risk assessment (exposure, concentration, drawdown)

Always show prices with appropriate precision. When discussing trades, mention the current mode (PAPER/LIVE).
Be concise. Use tables for data when appropriate.
Symbols use format: BTC/USDT, ETH/USDT, SOL/USDT etc.
"""


def _openai_tools() -> list[dict]:
    """Convert Anthropic-style tool definitions to OpenAI function calling format."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in TOOL_DEFINITIONS
    ]


class CryptoAgent:
    def __init__(self):
        self.exchange_manager = ExchangeManager()
        default_ex = (
            PaperExchange(config.default_exchange, config.initial_balance)
            if config.paper_trading
            else LiveExchange(config.default_exchange)
        )
        self.exchange_manager.register(config.default_exchange, default_ex)

        for ex_id, creds in config.extra_exchanges.items():
            if config.paper_trading:
                ex = PaperExchange(ex_id, config.initial_balance)
            else:
                ex = LiveExchange(ex_id, creds.get("api_key", ""), creds.get("secret", ""))
            self.exchange_manager.register(ex_id, ex)

        self.messages: list = []
        self.provider = config.llm_provider

        if self.provider == "openai":
            from openai import OpenAI
            self.client = OpenAI(
                api_key=config.api_key,
                base_url=config.api_base_url or None,
            )
        else:
            from anthropic import Anthropic
            self.client = Anthropic(
                api_key=config.api_key,
                base_url=config.api_base_url or None,
            )

    @property
    def exchange(self):
        return self.exchange_manager.active

    async def _dispatch_tool(self, name: str, inputs: dict) -> str:
        handler = TOOL_HANDLERS.get(name)
        if not handler:
            return f"Unknown tool: {name}"
        if name == "exchange_manage":
            return await handler(exchange_manager=self.exchange_manager, **inputs)
        if name == "market_data" and inputs.get("exchange_id"):
            try:
                ex = self.exchange_manager.get(inputs["exchange_id"])
            except KeyError as e:
                return str(e)
            return await handler(exchange=ex, **inputs)
        if name in ("execute_trade", "risk_check"):
            return await handler(exchange=self.exchange, config=config, **inputs)
        if name == "schedule":
            return await handler(**inputs)
        return await handler(exchange=self.exchange, **inputs)

    async def chat(self, user_message: str) -> str:
        self.messages.append({"role": "user", "content": user_message})

        if self.provider == "openai":
            return await self._chat_openai()
        return await self._chat_anthropic()

    async def _chat_openai(self) -> str:
        tools = _openai_tools()
        while True:
            response = self.client.chat.completions.create(
                model=config.model_id,
                messages=[{"role": "system", "content": SYSTEM}] + self.messages,
                tools=tools,
                max_tokens=4096,
            )
            choice = response.choices[0]
            msg = choice.message

            if not msg.tool_calls:
                self.messages.append({"role": "assistant", "content": msg.content or ""})
                return msg.content or ""

            self.messages.append({
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in msg.tool_calls
                ],
            })

            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                output = await self._dispatch_tool(tc.function.name, args)
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": output,
                })

    async def _chat_anthropic(self) -> str:
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
        await self.exchange_manager.close_all()
