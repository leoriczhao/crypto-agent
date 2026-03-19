#!/usr/bin/env python3
import sys
import asyncio
from rich.console import Console
from rich.markdown import Markdown
from .agent import CryptoAgent
from .config import config

console = Console()


async def main():
    agent = CryptoAgent()
    mode = "PAPER" if config.paper_trading else "LIVE"
    exchange_count = len(agent.exchange_manager.list())
    extra = f" + {exchange_count - 1} more" if exchange_count > 1 else ""
    soul_name = agent.soul.name
    console.print(f"\n[bold cyan]Crypto Agent[/] [dim]({mode} mode | {config.default_exchange}{extra} | {soul_name})[/dim]")
    console.print("[dim]Type your question or 'q' to quit.[/dim]\n")

    try:
        while True:
            try:
                sys.stdout.write("\033[32m>> \033[0m")
                sys.stdout.flush()
                query = sys.stdin.readline()
                if not query:
                    break
                query = query.rstrip("\n")
            except (EOFError, KeyboardInterrupt):
                break
            if query.strip().lower() in ("q", "exit", "quit", ""):
                break

            console.print("[dim]Thinking...[/dim]")
            response = await agent.chat(query)

            console.print()
            console.print(Markdown(response))
            console.print()
    finally:
        await agent.close()
        console.print("[dim]Bye![/dim]")


def run():
    asyncio.run(main())


if __name__ == "__main__":
    run()
