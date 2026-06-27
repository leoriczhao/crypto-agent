from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    database_path: Path = Path("data/crypto_agent.db")
    environment: str = "development"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_path=Path(os.getenv("MEMORY_DB_PATH", "data/crypto_agent.db")),
            environment=os.getenv("CRYPTO_AGENT_ENV", "development"),
        )
