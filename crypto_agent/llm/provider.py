"""
Build API kwargs per backend. Different gateways/models expect different fields;
optional params are omitted when unset so the server default applies.

OpenAI-compatible: sampling + max_tokens + optional extra_body (JSON) for vendor extensions.
Anthropic: max_tokens + temperature/top_p/top_k when set.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..config import Config


def openai_chat_completion_kwargs(cfg: "Config", *, max_tokens: int | None = None) -> dict[str, Any]:
    """Kwargs for client.chat.completions.create (excluding messages/tools)."""
    mt = cfg.llm_max_tokens if max_tokens is None else max_tokens
    out: dict[str, Any] = {
        "model": cfg.model_id,
        "max_tokens": mt,
    }
    if cfg.llm_temperature is not None:
        out["temperature"] = cfg.llm_temperature
    if cfg.llm_top_p is not None:
        out["top_p"] = cfg.llm_top_p
    if cfg.llm_frequency_penalty is not None:
        out["frequency_penalty"] = cfg.llm_frequency_penalty
    if cfg.llm_presence_penalty is not None:
        out["presence_penalty"] = cfg.llm_presence_penalty
    if cfg.llm_seed is not None:
        out["seed"] = cfg.llm_seed
    if cfg.llm_stop:
        out["stop"] = cfg.llm_stop
    if cfg.llm_extra_body:
        out["extra_body"] = dict(cfg.llm_extra_body)
    return out


def openai_sub_agent_kwargs(cfg: "Config") -> dict[str, Any]:
    """Same sampling/extra_body as main agent, sub-agent max_tokens."""
    return openai_chat_completion_kwargs(cfg, max_tokens=cfg.sub_agent_max_tokens)


def anthropic_message_kwargs(cfg: "Config", *, max_tokens: int | None = None) -> dict[str, Any]:
    """Kwargs for client.messages.create (excluding system/messages/tools)."""
    mt = cfg.llm_max_tokens if max_tokens is None else max_tokens
    out: dict[str, Any] = {
        "model": cfg.model_id,
        "max_tokens": mt,
    }
    if cfg.llm_temperature is not None:
        out["temperature"] = cfg.llm_temperature
    if cfg.llm_top_p is not None:
        out["top_p"] = cfg.llm_top_p
    if cfg.anthropic_top_k is not None:
        out["top_k"] = cfg.anthropic_top_k
    return out


def anthropic_sub_agent_kwargs(cfg: "Config") -> dict[str, Any]:
    return anthropic_message_kwargs(cfg, max_tokens=cfg.sub_agent_max_tokens)


def compact_summary_openai_kwargs(cfg: "Config") -> dict[str, Any]:
    model = cfg.compact_summary_model_id or cfg.model_id
    out: dict[str, Any] = {
        "model": model,
        "max_tokens": cfg.compact_summary_max_tokens,
    }
    if cfg.llm_temperature is not None:
        out["temperature"] = cfg.llm_temperature
    if cfg.llm_top_p is not None:
        out["top_p"] = cfg.llm_top_p
    if cfg.llm_extra_body:
        out["extra_body"] = dict(cfg.llm_extra_body)
    return out


def compact_summary_anthropic_kwargs(cfg: "Config") -> dict[str, Any]:
    model = cfg.compact_summary_model_id or cfg.model_id
    out: dict[str, Any] = {
        "model": model,
        "max_tokens": cfg.compact_summary_max_tokens,
    }
    if cfg.llm_temperature is not None:
        out["temperature"] = cfg.llm_temperature
    if cfg.llm_top_p is not None:
        out["top_p"] = cfg.llm_top_p
    if cfg.anthropic_top_k is not None:
        out["top_k"] = cfg.anthropic_top_k
    return out

