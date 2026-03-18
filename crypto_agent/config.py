import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv(override=True)

if os.getenv("ANTHROPIC_BASE_URL"):
    os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)


@dataclass
class Config:
    anthropic_api_key: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", ""))
    anthropic_base_url: str = field(default_factory=lambda: os.getenv("ANTHROPIC_BASE_URL", ""))
    model_id: str = field(default_factory=lambda: os.environ.get("MODEL_ID", "claude-sonnet-4-6"))
    default_exchange: str = field(default_factory=lambda: os.getenv("DEFAULT_EXCHANGE", "binance"))
    paper_trading: bool = field(default_factory=lambda: os.getenv("PAPER_TRADING", "true").lower() == "true")
    initial_balance: dict = field(default_factory=lambda: {"USDT": float(os.getenv("INITIAL_BALANCE_USDT", "10000"))})
    max_order_size_usdt: float = field(default_factory=lambda: float(os.getenv("MAX_ORDER_SIZE_USDT", "1000")))


config = Config()
