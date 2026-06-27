from crypto_agent.config import Settings
from crypto_agent.main import build_health_payload


def test_health_payload_reports_runtime_and_database_path(tmp_path):
    settings = Settings(database_path=tmp_path / "crypto_agent.db", environment="test")

    payload = build_health_payload(settings)

    assert payload["status"] == "ok"
    assert payload["runtime"] == "python"
    assert payload["environment"] == "test"
    assert payload["database_path"].endswith("crypto_agent.db")
