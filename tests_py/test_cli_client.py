import importlib.util
import json

import pytest

from crypto_agent.cli.main import main as cli_main
from crypto_agent.config import Settings
from crypto_agent.ipc.server import CryptoAgentIpcServer

HAS_LANGGRAPH = importlib.util.find_spec("langgraph") is not None


def test_cli_client_health_reads_from_daemon_socket(tmp_path, capsys):
    socket_path = tmp_path / "crypto-agent.sock"
    settings = Settings(database_path=tmp_path / "crypto_agent.db", environment="test")
    server = CryptoAgentIpcServer(settings=settings, socket_path=socket_path)
    server.start_in_thread()
    try:
        exit_code = cli_main(["--socket-path", str(socket_path), "health"])
    finally:
        server.stop()

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is True
    assert payload["result"]["runtime"] == "python"


@pytest.mark.skipif(not HAS_LANGGRAPH, reason="langgraph is not installed")
def test_cli_client_smoke_reads_from_daemon_socket(tmp_path, capsys):
    socket_path = tmp_path / "crypto-agent.sock"
    profile_path = tmp_path / "AGENT.md"
    profile_path.write_text("# CLI Smoke Resident\n", encoding="utf-8")
    settings = Settings(database_path=tmp_path / "crypto_agent.db", environment="test")
    server = CryptoAgentIpcServer(settings=settings, socket_path=socket_path)
    server.start_in_thread()
    try:
        exit_code = cli_main(
            [
                "--socket-path",
                str(socket_path),
                "smoke",
                "--profile-path",
                str(profile_path),
                "--destructive",
            ]
        )
    finally:
        server.stop()

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is True
    assert payload["result"]["trader_outcome"] == "ordered"
    assert payload["result"]["close_order_status"] == "filled"
