import pytest
from crypto_agent.memory import Memory


@pytest.fixture
def mem(tmp_path):
    db = str(tmp_path / "test.db")
    m = Memory(db)
    yield m
    m.close()


def test_save_and_load_messages(mem):
    mem.save_message("user", "hello")
    mem.save_message("assistant", "hi there")
    messages = mem.load_recent_messages(10)
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["content"] == "hi there"


def test_cron_jobs(mem):
    job_id = mem.add_cron_job("check BTC", "every_60m", "2020-01-01T00:00:00")
    jobs = mem.get_due_cron_jobs()
    assert len(jobs) == 1
    assert jobs[0]["description"] == "check BTC"
    mem.delete_cron_job(job_id)
    assert len(mem.list_cron_jobs()) == 0


def test_events(mem):
    mem.log_event("heartbeat", "all clear")
