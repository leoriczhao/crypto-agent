from __future__ import annotations

import json
import socketserver
import threading
from pathlib import Path
from typing import Any

from crypto_agent.config import Settings
from crypto_agent.main import build_health_payload, run_closed_loop_smoke


class CryptoAgentIpcServer:
    def __init__(self, *, settings: Settings, socket_path: str | Path):
        self.settings = settings
        self.socket_path = Path(socket_path)
        self._server: _UnixServer | None = None
        self._thread: threading.Thread | None = None

    def start_in_thread(self) -> None:
        self.socket_path.parent.mkdir(parents=True, exist_ok=True)
        self.socket_path.unlink(missing_ok=True)
        self._server = _UnixServer(str(self.socket_path), _RequestHandler)
        self._server.owner = self
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def serve_forever(self) -> None:
        self.socket_path.parent.mkdir(parents=True, exist_ok=True)
        self.socket_path.unlink(missing_ok=True)
        self._server = _UnixServer(str(self.socket_path), _RequestHandler)
        self._server.owner = self
        try:
            self._server.serve_forever()
        finally:
            if self._server is not None:
                self._server.server_close()
                self._server = None
            self.socket_path.unlink(missing_ok=True)

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None
        self.socket_path.unlink(missing_ok=True)

    def handle_message(self, message: dict[str, Any]) -> dict[str, Any]:
        message_type = message.get("type")
        if message_type == "health":
            return {"ok": True, "result": build_health_payload(self.settings)}
        if message_type == "smoke":
            return {
                "ok": True,
                "result": run_closed_loop_smoke(
                    database_path=self.settings.database_path,
                    profile_path=Path(message["profile_path"]),
                    destructive=bool(message.get("destructive", False)),
                ),
            }
        return {"ok": False, "error": f"unknown message type: {message_type}"}


class _UnixServer(socketserver.UnixStreamServer):
    owner: CryptoAgentIpcServer


class _RequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        raw_line = self.rfile.readline()
        if not raw_line:
            return
        try:
            message = json.loads(raw_line.decode("utf-8"))
            response = self.server.owner.handle_message(message)  # type: ignore[attr-defined]
        except Exception as exc:
            response = {"ok": False, "error": str(exc)}
        self.wfile.write(json.dumps(response, ensure_ascii=False).encode("utf-8") + b"\n")
