import asyncio
from datetime import datetime, timedelta
from rich.console import Console
from .agent import CryptoAgent
from .config import config
from .memory import Memory
from .heartbeat import HeartbeatScheduler
from .notify import Notifier
from .tools.registry import TOOL_HANDLERS

console = Console()


class CryptoDaemon:
    def __init__(self):
        self.agent = CryptoAgent()
        self.memory = Memory(config.memory_db_path)
        self.notifier = Notifier(config.notify_telegram_token, config.notify_telegram_chat_id)
        self.heartbeat = HeartbeatScheduler(
            self.agent,
            interval=config.heartbeat_interval,
            on_response=self._on_heartbeat_response,
        )
        self._patch_schedule_handler()
        self._restore_memory()

    def _patch_schedule_handler(self):
        original = TOOL_HANDLERS.get("schedule")
        if original:
            memory = self.memory
            async def patched_handler(**kwargs):
                return await original(memory=memory, **kwargs)
            TOOL_HANDLERS["schedule"] = patched_handler

    def _restore_memory(self):
        messages = self.memory.load_recent_messages(limit=20)
        if messages:
            self.agent.messages = messages
            console.print(f"[dim]Restored {len(messages)} messages from memory[/dim]")

    async def _on_heartbeat_response(self, response: str):
        if "all clear" not in response.lower():
            console.print(f"\n{response}")
            if self.notifier.enabled:
                await self.notifier.send(response)

    async def _check_cron_jobs(self):
        while True:
            await asyncio.sleep(30)
            due_jobs = self.memory.get_due_cron_jobs()
            for job in due_jobs:
                try:
                    response = await self.agent.chat(f"[CRON] Execute scheduled task: {job['description']}")
                    console.print(f"\n[dim][Cron #{job['id']}][/dim] {response[:200]}")
                    interval = int(job["cron_expr"].replace("every_", "").replace("m", ""))
                    next_run = (datetime.now() + timedelta(minutes=interval)).isoformat()
                    self.memory.update_cron_next_run(job["id"], next_run)
                except Exception as e:
                    console.print(f"[red]Cron error: {e}[/red]")

    async def run(self):
        mode = "PAPER" if config.paper_trading else "LIVE"
        exchange_count = len(self.agent.exchange_manager.list())
        extra = f" + {exchange_count - 1} more" if exchange_count > 1 else ""
        console.print(f"\n[bold cyan]Crypto Agent Daemon[/] [dim]({mode} | {config.default_exchange}{extra} | heartbeat: {config.heartbeat_interval}s)[/dim]")
        if self.notifier.enabled:
            console.print("[dim]Telegram notifications: enabled[/dim]")
        console.print("[dim]Type message or 'q' to quit. Heartbeat runs in background.[/dim]\n")

        await self.heartbeat.start()
        cron_task = asyncio.create_task(self._check_cron_jobs())

        try:
            while True:
                try:
                    query = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: console.input("[bold green]>> [/]")
                    )
                except (EOFError, KeyboardInterrupt):
                    break
                if query.strip().lower() in ("q", "exit", "quit", ""):
                    break

                self.memory.save_message("user", query)
                response = await self.agent.chat(query)
                self.memory.save_message("assistant", response)

                console.print()
                from rich.markdown import Markdown
                console.print(Markdown(response))
                console.print()
        finally:
            await self.heartbeat.stop()
            cron_task.cancel()
            await self.agent.close()
            self.memory.close()
            console.print("[dim]Daemon stopped.[/dim]")


def run_daemon():
    asyncio.run(CryptoDaemon().run())
