import json
import sqlite3

from crypto_agent.main import main


def test_health_command_prints_json_without_llm_key(tmp_path, capsys):
    db_path = tmp_path / "crypto_agent.db"

    exit_code = main(["health", "--database-path", str(db_path), "--environment", "test"])

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "ok"
    assert payload["runtime"] == "python"
    assert payload["environment"] == "test"
    assert payload["database_path"] == str(db_path)


def test_init_db_command_creates_schema(tmp_path, capsys):
    db_path = tmp_path / "crypto_agent.db"

    exit_code = main(["init-db", "--database-path", str(db_path), "--destructive"])

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "initialized"
    with sqlite3.connect(db_path) as conn:
        count = conn.execute("select count(*) from funding_accounts").fetchone()[0]
    assert count == 1
