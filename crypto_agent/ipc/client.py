from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any


class CryptoAgentIpcClient:
    def __init__(self, socket_path: str | Path):
        self.socket_path = Path(socket_path)

    def request(self, payload: dict[str, Any]) -> dict[str, Any]:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(self.socket_path))
            client.sendall(json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n")
            return json.loads(client.makefile("r", encoding="utf-8").readline())
