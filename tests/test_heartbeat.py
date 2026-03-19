import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock
from crypto_agent.heartbeat import HeartbeatScheduler


@pytest.mark.asyncio
async def test_heartbeat_runs():
    agent = MagicMock()
    agent.chat = AsyncMock(return_value="All clear.")
    hb = HeartbeatScheduler(agent, interval=1)
    await hb.start()
    await asyncio.sleep(1.5)
    await hb.stop()
    assert agent.chat.called
