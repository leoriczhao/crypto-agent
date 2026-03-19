import asyncio
from datetime import datetime


HEARTBEAT_PROMPT = """[HEARTBEAT {timestamp}]
This is an automatic heartbeat check. Review the current state:
1. Check if any positions need attention (stop-loss, take-profit)
2. Check for any significant price movements
3. Check if any scheduled tasks are due

If nothing needs attention, respond briefly with "All clear."
If action is needed, take it and report what you did.
"""


class HeartbeatScheduler:
    def __init__(self, agent, interval: int = 60, on_response=None):
        self.agent = agent
        self.interval = interval
        self.on_response = on_response
        self._running = False
        self._task = None

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def _loop(self):
        while self._running:
            await asyncio.sleep(self.interval)
            if not self._running:
                break
            try:
                timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                prompt = HEARTBEAT_PROMPT.format(timestamp=timestamp)
                response = await self.agent.chat(prompt)
                if self.on_response:
                    await self.on_response(f"[Heartbeat] {response}")
            except Exception as e:
                if self.on_response:
                    await self.on_response(f"[Heartbeat error] {e}")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
