import json
import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv(override=True)

if os.getenv("ANTHROPIC_BASE_URL"):
    os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)


@dataclass
class Config:
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "openai"))
    api_key: str = field(default_factory=lambda: os.getenv("API_KEY", os.getenv("OPENAI_API_KEY", os.getenv("ANTHROPIC_API_KEY", ""))))
    api_base_url: str = field(default_factory=lambda: os.getenv("API_BASE_URL", os.getenv("OPENAI_BASE_URL", os.getenv("ANTHROPIC_BASE_URL", ""))))
    model_id: str = field(default_factory=lambda: os.getenv("MODEL_ID", "gpt-5.4-mini"))
    default_exchange: str = field(default_factory=lambda: os.getenv("DEFAULT_EXCHANGE", "gateio"))
    paper_trading: bool = field(default_factory=lambda: os.getenv("PAPER_TRADING", "true").lower() == "true")
    initial_balance: dict = field(default_factory=lambda: {"USDT": float(os.getenv("INITIAL_BALANCE_USDT", "10000"))})
    max_order_size_usdt: float = field(default_factory=lambda: float(os.getenv("MAX_ORDER_SIZE_USDT", "1000")))
    heartbeat_interval: int = field(default_factory=lambda: int(os.getenv("HEARTBEAT_INTERVAL", "60")))
    memory_db_path: str = field(default_factory=lambda: os.getenv("MEMORY_DB_PATH", "crypto_agent.db"))
    notify_telegram_token: str = field(default_factory=lambda: os.getenv("TELEGRAM_BOT_TOKEN", ""))
    notify_telegram_chat_id: str = field(default_factory=lambda: os.getenv("TELEGRAM_CHAT_ID", ""))
    extra_exchanges: dict = field(default_factory=lambda: json.loads(os.getenv("EXTRA_EXCHANGES", "{}")))
    trading_soul: str = field(default_factory=lambda: os.getenv("TRADING_SOUL", "balanced"))


config = Config()
