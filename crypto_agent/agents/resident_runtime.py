from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Literal

from crypto_agent.agents.researcher_graph import build_researcher_graph
from crypto_agent.agents.trader_graph import build_trader_graph

ResidentType = Literal["researcher", "trader", "risk_officer", "operator"]


class ResidentRuntime:
    def __init__(self, db_path: str | Path, *, tool_registry: Any, deps: dict[str, Any]):
        self.db_path = Path(db_path)
        self.tool_registry = tool_registry
        self.deps = deps

    def spawn_resident(
        self,
        *,
        type: ResidentType,
        name: str,
        profile_path: str | Path,
        bot_id: str,
        interval_minutes: int | None = None,
    ) -> str:
        profile = Path(profile_path)
        if not profile.exists():
            raise FileNotFoundError(f"resident profile not found: {profile}")

        resident_id = f"resident-{uuid.uuid4()}"
        profile_hash = _hash_file(profile)
        with self._connect() as conn:
            conn.execute(
                """
                insert into resident_agents (
                  id, bot_id, type, name, profile_path, profile_hash,
                  status, interval_minutes
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    resident_id,
                    bot_id,
                    type,
                    name,
                    str(profile),
                    profile_hash,
                    "active",
                    interval_minutes,
                ),
            )
        return resident_id

    def run_once(self, resident_agent_id: str, run_payload: dict[str, Any]) -> dict[str, Any]:
        resident = self._fetch_resident(resident_agent_id)
        run_id = f"agent-run-{uuid.uuid4()}"
        state = {
            **run_payload,
            "tool_registry": self.tool_registry,
            "deps": self.deps,
            "bot_id": resident["bot_id"],
            "resident_agent_id": resident_agent_id,
        }
        self._create_run(run_id, resident, run_payload)

        try:
            graph = self._graph_for_type(resident["type"])
            final_state = graph.invoke(state)
            self._finish_run(run_id, "succeeded", output=_audit_json(final_state), error=None)
            return final_state
        except Exception as exc:
            self._finish_run(run_id, "failed", output=None, error=str(exc))
            raise

    def _graph_for_type(self, resident_type: str) -> Any:
        if resident_type == "researcher":
            return build_researcher_graph()
        if resident_type == "trader":
            return build_trader_graph()
        raise ValueError(f"unsupported resident type: {resident_type}")

    def _fetch_resident(self, resident_agent_id: str) -> sqlite3.Row:
        with self._connect() as conn:
            row = conn.execute(
                "select * from resident_agents where id = ?",
                (resident_agent_id,),
            ).fetchone()
        if row is None:
            raise KeyError(f"resident agent not found: {resident_agent_id}")
        return row

    def _create_run(
        self,
        run_id: str,
        resident: sqlite3.Row,
        run_payload: dict[str, Any],
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                insert into agent_runs (
                  id, resident_agent_id, bot_id, run_type, status,
                  input, profile_path, profile_hash
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    resident["id"],
                    resident["bot_id"],
                    resident["type"],
                    "running",
                    json.dumps(run_payload, ensure_ascii=False),
                    resident["profile_path"],
                    resident["profile_hash"],
                ),
            )

    def _finish_run(
        self,
        run_id: str,
        status: Literal["succeeded", "failed"],
        *,
        output: str | None,
        error: str | None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                update agent_runs
                set status = ?, finished_at = datetime('now'), output = ?, error = ?
                where id = ?
                """,
                (status, output, error, run_id),
            )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma foreign_keys = on")
        return conn


def _hash_file(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _audit_json(state: dict[str, Any]) -> str:
    safe_state = {
        key: value
        for key, value in state.items()
        if key not in {"tool_registry", "deps"}
    }
    return json.dumps(safe_state, ensure_ascii=False)
