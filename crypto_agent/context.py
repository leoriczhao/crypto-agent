import json
from datetime import datetime
from pathlib import Path

from .config import config


def estimate_tokens(messages: list) -> int:
    return len(json.dumps(messages, ensure_ascii=False)) // config.context_chars_per_token


def micro_compact(messages: list) -> list:
    """Layer 1: Replace old tool_result content with placeholders (silent, every turn)."""
    if not config.micro_compact_enabled:
        return messages

    keep_recent = max(0, config.micro_compact_keep_recent)
    min_len = config.micro_compact_min_content_len

    tool_result_indices = []
    for i, msg in enumerate(messages):
        if msg.get("role") == "tool":
            tool_result_indices.append(i)
        elif msg.get("role") == "user" and isinstance(msg.get("content"), list):
            for block in msg["content"]:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    tool_result_indices.append(i)
                    break

    if len(tool_result_indices) <= keep_recent:
        return messages

    if keep_recent == 0:
        to_compact = tool_result_indices
    else:
        to_compact = tool_result_indices[:-keep_recent]

    for idx in to_compact:
        msg = messages[idx]
        if msg.get("role") == "tool":
            if len(msg.get("content", "")) > min_len:
                messages[idx]["content"] = "[Previous tool result compacted]"
        elif isinstance(msg.get("content"), list):
            for block in msg["content"]:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    if len(str(block.get("content", ""))) > min_len:
                        block["content"] = "[Previous tool result compacted]"

    return messages


def auto_compact(
    messages: list,
    client,
    provider: str,
    transcript_dir: str | None = None,
    *,
    force: bool = False,
) -> list:
    """Layer 2: When estimated tokens exceed threshold, save transcript and summarize.

    ``force=True`` (e.g. compact tool): always summarize, ignoring AUTO_COMPACT_ENABLED
    and AUTO_COMPACT_TOKEN_THRESHOLD.
    """
    if not force and not config.auto_compact_enabled:
        return messages

    tokens = estimate_tokens(messages)
    if not force and tokens < config.auto_compact_token_threshold:
        return messages

    td = transcript_dir or config.auto_compact_transcript_dir
    _save_transcript(messages, td)

    text_parts = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if isinstance(content, str) and content:
            text_parts.append(f"[{role}] {content[:500]}")
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    text = block.get("text", block.get("content", ""))
                    if text:
                        text_parts.append(f"[{role}] {str(text)[:300]}")

    conversation_text = "\n".join(text_parts[-40:])

    summary_prompt = (
        "Summarize this trading agent conversation concisely. "
        "Preserve: current positions, pending orders, active strategies, "
        "key price levels mentioned, and any decisions made. "
        "Keep it under 500 words.\n\n"
        f"{conversation_text}"
    )

    from .llm.provider import compact_summary_openai_kwargs, compact_summary_anthropic_kwargs

    try:
        if provider == "openai":
            kwargs = compact_summary_openai_kwargs(config)
            resp = client.chat.completions.create(
                messages=[{"role": "user", "content": summary_prompt}],
                **kwargs,
            )
            summary = resp.choices[0].message.content
        else:
            kwargs = compact_summary_anthropic_kwargs(config)
            resp = client.messages.create(
                messages=[{"role": "user", "content": summary_prompt}],
                **kwargs,
            )
            summary = resp.content[0].text
    except Exception as e:
        summary = f"(auto-compact failed: {e}. Keeping last 10 messages.)"
        return messages[-10:]

    return [
        {
            "role": "user",
            "content": f"[Context compacted. Summary of previous conversation:]\n{summary}",
        },
        {"role": "assistant", "content": "Understood. I have the context summary. How can I help?"},
    ]


def _save_transcript(messages: list, transcript_dir: str):
    Path(transcript_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = Path(transcript_dir) / f"transcript_{ts}.json"
    try:
        with open(path, "w") as f:
            json.dump(messages, f, ensure_ascii=False, indent=2, default=str)
    except OSError:
        pass


# Backwards compatibility for tests / imports
KEEP_RECENT = 3
