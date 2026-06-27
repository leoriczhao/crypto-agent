import importlib.util
import json

import pytest

HAS_LANGGRAPH = importlib.util.find_spec("langgraph") is not None
pytestmark = pytest.mark.skipif(not HAS_LANGGRAPH, reason="langgraph is not installed")

if HAS_LANGGRAPH:
    from crypto_agent.main import main


def test_smoke_command_runs_researcher_to_trader_paper_loop(tmp_path, capsys):
    db_path = tmp_path / "crypto_agent.db"
    profile_path = tmp_path / "AGENT.md"
    profile_path.write_text("# Smoke Resident\n", encoding="utf-8")

    exit_code = main(
        [
            "smoke",
            "--database-path",
            str(db_path),
            "--profile-path",
            str(profile_path),
            "--destructive",
        ]
    )

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "ok"
    assert payload["researcher_outcome"] == "validated"
    assert payload["trader_outcome"] == "ordered"
    assert payload["strategy_deployment_id"].startswith("strategy-deployment-")
    assert payload["paper_order_status"] == "filled"
    assert payload["close_order_status"] == "filled"
    assert payload["realized_pnl"] == 1
