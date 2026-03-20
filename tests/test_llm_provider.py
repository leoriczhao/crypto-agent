"""Sanity checks for LLM kwargs assembly (no network)."""

import os

import pytest

from crypto_agent.config import Config
from crypto_agent.llm.provider import (
    anthropic_message_kwargs,
    openai_chat_completion_kwargs,
    openai_sub_agent_kwargs,
)


def test_openai_omits_unset_sampling(monkeypatch):
    monkeypatch.delenv("LLM_TEMPERATURE", raising=False)
    monkeypatch.delenv("LLM_TOP_P", raising=False)
    monkeypatch.delenv("LLM_EXTRA_BODY_JSON", raising=False)
    cfg = Config(model_id="test-model", llm_max_tokens=2048)
    kw = openai_chat_completion_kwargs(cfg)
    assert kw["model"] == "test-model"
    assert kw["max_tokens"] == 2048
    assert "temperature" not in kw
    assert "extra_body" not in kw


def test_openai_includes_optional_fields(monkeypatch):
    monkeypatch.setenv("LLM_TEMPERATURE", "0.2")
    monkeypatch.setenv("LLM_TOP_P", "0.9")
    monkeypatch.setenv("LLM_EXTRA_BODY_JSON", '{"foo":1}')
    cfg = Config()
    kw = openai_chat_completion_kwargs(cfg)
    assert kw["temperature"] == 0.2
    assert kw["top_p"] == 0.9
    assert kw["extra_body"] == {"foo": 1}


def test_sub_agent_uses_sub_max_tokens(monkeypatch):
    monkeypatch.setenv("LLM_MAX_TOKENS", "8000")
    monkeypatch.setenv("SUB_AGENT_MAX_TOKENS", "512")
    cfg = Config()
    main = openai_chat_completion_kwargs(cfg)
    sub = openai_sub_agent_kwargs(cfg)
    assert main["max_tokens"] == 8000
    assert sub["max_tokens"] == 512


def test_anthropic_top_k_optional(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_TOP_K", raising=False)
    cfg = Config(llm_max_tokens=4096)
    kw = anthropic_message_kwargs(cfg)
    assert "top_k" not in kw

    monkeypatch.setenv("ANTHROPIC_TOP_K", "10")
    cfg2 = Config()
    kw2 = anthropic_message_kwargs(cfg2)
    assert kw2["top_k"] == 10
