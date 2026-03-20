import json
import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv(override=True)

if os.getenv("ANTHROPIC_BASE_URL"):
    os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)


def _env_bool(key: str, default: bool) -> bool:
    v = os.getenv(key)
    if v is None or not str(v).strip():
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _env_opt_float(key: str) -> float | None:
    v = os.getenv(key)
    if v is None or not str(v).strip():
        return None
    return float(v)


def _env_opt_int(key: str) -> int | None:
    v = os.getenv(key)
    if v is None or not str(v).strip():
        return None
    return int(v)


def _env_json_object(key: str, default: dict) -> dict:
    raw = os.getenv(key)
    if not raw or not str(raw).strip():
        return default
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else default
    except json.JSONDecodeError:
        return default


def _env_stop_sequences() -> list[str] | None:
    raw = os.getenv("LLM_STOP")
    if not raw or not str(raw).strip():
        return None
    parts = [p.strip() for p in raw.split("|") if p.strip()]
    return parts or None


@dataclass
class Config:
    # --- LLM ---
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "openai"))
    api_key: str = field(
        default_factory=lambda: os.getenv(
            "API_KEY", os.getenv("OPENAI_API_KEY", os.getenv("ANTHROPIC_API_KEY", ""))
        )
    )
    api_base_url: str = field(
        default_factory=lambda: os.getenv(
            "API_BASE_URL",
            os.getenv("OPENAI_BASE_URL", os.getenv("ANTHROPIC_BASE_URL", "")),
        )
    )
    model_id: str = field(default_factory=lambda: os.getenv("MODEL_ID", "gpt-5.4"))
    llm_max_tokens: int = field(default_factory=lambda: int(os.getenv("LLM_MAX_TOKENS", "4096")))
    llm_context_window: int = field(default_factory=lambda: int(os.getenv("LLM_CONTEXT_WINDOW", "500000")))
    llm_temperature: float | None = field(default_factory=lambda: _env_opt_float("LLM_TEMPERATURE"))
    llm_top_p: float | None = field(default_factory=lambda: _env_opt_float("LLM_TOP_P"))
    llm_frequency_penalty: float | None = field(default_factory=lambda: _env_opt_float("LLM_FREQUENCY_PENALTY"))
    llm_presence_penalty: float | None = field(default_factory=lambda: _env_opt_float("LLM_PRESENCE_PENALTY"))
    llm_seed: int | None = field(default_factory=lambda: _env_opt_int("LLM_SEED"))
    llm_stop: list[str] | None = field(default_factory=_env_stop_sequences)
    llm_extra_body: dict = field(default_factory=lambda: _env_json_object("LLM_EXTRA_BODY_JSON", {}))
    anthropic_top_k: int | None = field(default_factory=lambda: _env_opt_int("ANTHROPIC_TOP_K"))

    # --- Sub-agent / compaction ---
    sub_agent_max_tokens: int = field(default_factory=lambda: int(os.getenv("SUB_AGENT_MAX_TOKENS", "2048")))
    compact_summary_max_tokens: int = field(default_factory=lambda: int(os.getenv("COMPACT_SUMMARY_MAX_TOKENS", "1024")))
    compact_summary_model_id: str = field(default_factory=lambda: (os.getenv("COMPACT_SUMMARY_MODEL_ID") or "").strip())

    # --- Context compaction ---
    context_chars_per_token: int = field(default_factory=lambda: max(1, int(os.getenv("CONTEXT_CHARS_PER_TOKEN", "4"))))
    micro_compact_enabled: bool = field(default_factory=lambda: _env_bool("MICRO_COMPACT_ENABLED", True))
    micro_compact_keep_recent: int = field(default_factory=lambda: max(0, int(os.getenv("MICRO_COMPACT_KEEP_RECENT", "3"))))
    micro_compact_min_content_len: int = field(default_factory=lambda: max(1, int(os.getenv("MICRO_COMPACT_MIN_CONTENT_LEN", "200"))))
    auto_compact_enabled: bool = field(default_factory=lambda: _env_bool("AUTO_COMPACT_ENABLED", False))
    auto_compact_token_threshold: int = field(default_factory=lambda: int(os.getenv("AUTO_COMPACT_TOKEN_THRESHOLD", os.getenv("LLM_CONTEXT_WINDOW", "500000"))))
    auto_compact_transcript_dir: str = field(default_factory=lambda: os.getenv("AUTO_COMPACT_TRANSCRIPT_DIR", ".transcripts"))

    # --- Trading ---
    default_exchange: str = field(default_factory=lambda: os.getenv("DEFAULT_EXCHANGE", "gateio"))
    paper_trading: bool = field(default_factory=lambda: os.getenv("PAPER_TRADING", "true").lower() == "true")
    initial_balance: dict = field(default_factory=lambda: {"USDT": float(os.getenv("INITIAL_BALANCE_USDT", "10000"))})
    max_order_size_usdt: float = field(default_factory=lambda: float(os.getenv("MAX_ORDER_SIZE_USDT", "1000")))
    heartbeat_interval: int = field(default_factory=lambda: int(os.getenv("HEARTBEAT_INTERVAL", "60")))
    memory_db_path: str = field(default_factory=lambda: os.getenv("MEMORY_DB_PATH", "crypto_agent.db"))
    notify_telegram_token: str = field(default_factory=lambda: os.getenv("TELEGRAM_BOT_TOKEN", ""))
    notify_telegram_chat_id: str = field(default_factory=lambda: os.getenv("TELEGRAM_CHAT_ID", ""))
    exchange_api_key: str = field(default_factory=lambda: os.getenv("EXCHANGE_API_KEY", ""))
    exchange_secret: str = field(default_factory=lambda: os.getenv("EXCHANGE_SECRET", ""))
    exchange_password: str = field(default_factory=lambda: os.getenv("EXCHANGE_PASSWORD", ""))
    extra_exchanges: dict = field(default_factory=lambda: json.loads(os.getenv("EXTRA_EXCHANGES", "{}")))
    trading_soul: str = field(default_factory=lambda: os.getenv("TRADING_SOUL", "balanced"))


config = Config()
