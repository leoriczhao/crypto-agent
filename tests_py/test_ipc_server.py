import json
import socket
import importlib.util

import pytest
from crypto_agent.config import Settings
from crypto_agent.ipc.server import CryptoAgentIpcServer

HAS_LANGGRAPH = importlib.util.find_spec("langgraph") is not None


def request(socket_path, payload):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(str(socket_path))
        client.sendall(json.dumps(payload).encode("utf-8") + b"\n")
        return json.loads(client.makefile("r", encoding="utf-8").readline())


def test_ipc_server_returns_health_payload(tmp_path):
    socket_path = tmp_path / "crypto-agent.sock"
    settings = Settings(database_path=tmp_path / "crypto_agent.db", environment="test")
    server = CryptoAgentIpcServer(settings=settings, socket_path=socket_path)
    server.start_in_thread()
    try:
        response = request(socket_path, {"type": "health"})
    finally:
        server.stop()

    assert response["ok"] is True
    assert response["result"]["status"] == "ok"
    assert response["result"]["runtime"] == "python"
    assert response["result"]["database_path"].endswith("crypto_agent.db")


@pytest.mark.skipif(not HAS_LANGGRAPH, reason="langgraph is not installed")
def test_ipc_server_runs_smoke_loop(tmp_path):
    socket_path = tmp_path / "crypto-agent.sock"
    profile_path = tmp_path / "AGENT.md"
    profile_path.write_text("# IPC Smoke Resident\n", encoding="utf-8")
    settings = Settings(database_path=tmp_path / "crypto_agent.db", environment="test")
    server = CryptoAgentIpcServer(settings=settings, socket_path=socket_path)
    server.start_in_thread()
    try:
        response = request(
            socket_path,
            {
                "type": "smoke",
                "profile_path": str(profile_path),
                "destructive": True,
            },
        )
    finally:
        server.stop()

    assert response["ok"] is True
    assert response["result"]["researcher_outcome"] == "validated"
    assert response["result"]["trader_outcome"] == "ordered"
    assert response["result"]["paper_order_status"] == "filled"
    assert response["result"]["close_order_status"] == "filled"
