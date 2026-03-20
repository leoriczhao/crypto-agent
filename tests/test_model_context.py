from crypto_agent.config import Config


def test_context_window_default():
    cfg = Config()
    assert cfg.llm_context_window == 500_000


def test_context_window_env(monkeypatch):
    monkeypatch.setenv("LLM_CONTEXT_WINDOW", "200000")
    cfg = Config()
    assert cfg.llm_context_window == 200_000


def test_auto_compact_threshold_follows_context_window(monkeypatch):
    monkeypatch.delenv("AUTO_COMPACT_TOKEN_THRESHOLD", raising=False)
    monkeypatch.setenv("LLM_CONTEXT_WINDOW", "300000")
    cfg = Config()
    assert cfg.auto_compact_token_threshold == 300_000


def test_auto_compact_threshold_explicit(monkeypatch):
    monkeypatch.setenv("AUTO_COMPACT_TOKEN_THRESHOLD", "12345")
    cfg = Config()
    assert cfg.auto_compact_token_threshold == 12345
