#!/usr/bin/env python3
import asyncio
from rich.console import Console
from rich.markdown import Markdown
from .agent import CryptoAgent
from .config import config

console = Console()


async def main():
    agent = CryptoAgent()
    mode = "PAPER" if config.paper_trading else "LIVE"
    console.print(f"\n[bold cyan]Crypto Agent[/] [dim]({mode} mode | {config.default_exchange})[/dim]")
    console.print("[dim]Type your question or 'q' to quit.[/dim]\n")

    try:
        while True:
            try:
                query = console.input("[bold green]>> [/]")
            except (EOFError, KeyboardInterrupt):
                break
            if query.strip().lower() in ("q", "exit", "quit", ""):
                break

            with console.status("[dim]Thinking...[/dim]"):
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
