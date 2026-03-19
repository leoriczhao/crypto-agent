import json
from pathlib import Path
from .config import config
from .exchange.paper import PaperExchange
from .exchange.live import LiveExchange
from .exchange.manager import ExchangeManager
from .tools.registry import TOOL_DEFINITIONS, TOOL_HANDLERS
from .soul import Soul
from .skill_loader import SkillLoader
from .context import micro_compact, auto_compact, estimate_tokens
from . import tools  # noqa: F401 — triggers tool registration

SKILLS_DIR = Path(__file__).parent.parent / "skills"


SYSTEM_BASE = """You are a cryptocurrency trading assistant. Each of your tools does ONE thing:

Market: get_price, get_klines
Trade: buy, sell, cancel_order
Portfolio: get_portfolio (balances + positions + PnL)
Analysis: analyze (SMA/RSI/Bollinger + signals), assess_risk, backtest
Research: get_news (headlines + sentiment), get_chain_stats
Control: delegate (to researcher/trader/risk_officer), switch_exchange, switch_soul, schedule
Knowledge: load_skill (domain expertise on demand), compact (free context space)

Compose tools to answer complex questions. Example:
  "Should I buy ETH?" → get_price + analyze + get_news + assess_risk → synthesize answer

Always mention mode (PAPER/LIVE) when discussing trades.
Be concise. Use tables for data. Symbols: BTC/USDT, ETH/USDT, SOL/USDT etc.
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
            else LiveExchange(config.default_exchange, config.exchange_api_key,
                              config.exchange_secret, config.exchange_password)
        )
        self.exchange_manager.register(config.default_exchange, default_ex)

        for ex_id, creds in config.extra_exchanges.items():
            if config.paper_trading:
                ex = PaperExchange(ex_id, config.initial_balance)
            else:
                ex = LiveExchange(ex_id, creds.get("api_key", ""), creds.get("secret", ""))
            self.exchange_manager.register(ex_id, ex)

        self.soul = Soul(config.trading_soul)
        self.skill_loader = SkillLoader(SKILLS_DIR)
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

    @property
    def system_prompt(self) -> str:
        skills_section = self.skill_loader.get_descriptions()
        return SYSTEM_BASE + f"\nSkills available (use load_skill to access):\n{skills_section}" + self.soul.system_modifier

    def _compact_model(self) -> str:
        return config.model_id

    async def _dispatch_tool(self, name: str, inputs: dict) -> str:
        handler = TOOL_HANDLERS.get(name)
        if not handler:
            return f"Unknown tool: {name}"

        # Tools with special dependencies
        if name == "switch_exchange":
            return await handler(exchange_manager=self.exchange_manager, **inputs)
        if name == "delegate":
            return await handler(agent=self, **inputs)
        if name == "switch_soul":
            return await handler(soul=self.soul, **inputs)
        if name == "load_skill":
            return await handler(skill_loader=self.skill_loader, **inputs)
        if name == "compact":
            return await handler(agent=self, **inputs)
        if name == "schedule":
            return await handler(**inputs)

        # Tools that need config (buy, sell, assess_risk)
        if name in ("buy", "sell", "assess_risk"):
            return await handler(exchange=self.exchange, config=config, **inputs)

        # All other tools just need the active exchange
        return await handler(exchange=self.exchange, **inputs)

    async def chat(self, user_message: str) -> str:
        self.messages.append({"role": "user", "content": user_message})
        self.messages = micro_compact(self.messages)
        self.messages = auto_compact(
            self.messages, self.client, self._compact_model(), self.provider,
        )

        if self.provider == "openai":
            return await self._chat_openai()
        return await self._chat_anthropic()

    async def _chat_openai(self) -> str:
        tools = _openai_tools()
        while True:
            response = self.client.chat.completions.create(
                model=config.model_id,
                messages=[{"role": "system", "content": self.system_prompt}] + self.messages,
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
                system=self.system_prompt,
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
