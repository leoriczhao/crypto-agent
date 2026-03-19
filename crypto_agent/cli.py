#!/usr/bin/env python3
import asyncio
import os
from prompt_toolkit import PromptSession
from prompt_toolkit.history import FileHistory
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.styles import Style
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.table import Table
from .agent import CryptoAgent
from .config import config

console = Console()

HISTORY_FILE = os.path.expanduser("~/.crypto_agent_history")

COMMANDS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "DOGE/USDT",
    "ticker", "klines", "orderbook", "balance", "positions", "orders",
    "buy", "sell", "backtest", "strategy", "analyze", "signals",
    "risk", "news", "sentiment", "chain", "fees",
    "switch to conservative", "switch to balanced", "switch to aggressive",
    "delegate to researcher", "delegate to trader", "delegate to risk_officer",
    "exchange list", "exchange switch", "exchange status",
    "help", "quit", "exit",
]

prompt_style = Style.from_dict({
    "prompt": "bold ansigreen",
    "": "ansiwhite",
})


def _build_banner(agent: CryptoAgent) -> Panel:
    mode = "[bold red]LIVE[/]" if not config.paper_trading else "[bold green]PAPER[/]"
    exchange_count = len(agent.exchange_manager.list())
    exchanges = ", ".join(agent.exchange_manager.list())

    table = Table.grid(padding=(0, 2))
    table.add_column(style="dim")
    table.add_column()
    table.add_row("Mode", mode)
    table.add_row("Exchange", f"{exchanges}" + (f" ({exchange_count} connected)" if exchange_count > 1 else ""))
    table.add_row("Personality", f"[cyan]{agent.soul.name}[/]")
    table.add_row("Model", f"[dim]{config.model_id}[/]")

    return Panel(
        table,
        title="[bold cyan]Crypto Agent[/]",
        subtitle="[dim]↑↓ history | Tab complete | Ctrl+D quit[/dim]",
        border_style="cyan",
        expand=False,
    )


async def main():
    agent = CryptoAgent()
    completer = WordCompleter(COMMANDS, ignore_case=True, sentence=True)
    session: PromptSession = PromptSession(
        history=FileHistory(HISTORY_FILE),
        auto_suggest=AutoSuggestFromHistory(),
        completer=completer,
        style=prompt_style,
        complete_while_typing=False,
    )

    console.print()
    console.print(_build_banner(agent))
    console.print()

    try:
        while True:
            try:
                query = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: session.prompt(">> ", style=prompt_style)
                )
            except (EOFError, KeyboardInterrupt):
                break

            query = query.strip()
            if not query:
                continue
            if query.lower() in ("q", "exit", "quit"):
                break

            with console.status("[dim]Thinking...[/dim]", spinner="dots"):
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
