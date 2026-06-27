from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Sequence

from crypto_agent.ipc.client import CryptoAgentIpcClient


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    client = CryptoAgentIpcClient(args.socket_path)

    if args.command == "health":
        response = client.request({"type": "health"})
    elif args.command == "smoke":
        response = client.request(
            {
                "type": "smoke",
                "profile_path": str(args.profile_path),
                "destructive": args.destructive,
            }
        )
    else:
        parser.print_help()
        return 2

    print(json.dumps(response, ensure_ascii=False))
    return 0 if response.get("ok") else 1


def console_main() -> None:
    raise SystemExit(main())


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="crypto-agent-py-client")
    parser.add_argument(
        "--socket-path",
        default=os.getenv("CRYPTO_AGENT_SOCK", "/tmp/crypto-agent-py.sock"),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("health")
    smoke = subparsers.add_parser("smoke")
    smoke.add_argument("--profile-path", type=Path, required=True)
    smoke.add_argument("--destructive", action="store_true")
    return parser


if __name__ == "__main__":
    console_main()
