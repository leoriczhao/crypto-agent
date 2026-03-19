import json
import os
from datetime import datetime
from pathlib import Path


KEEP_RECENT = 3
TOKEN_THRESHOLD = 50_000
CHARS_PER_TOKEN = 4


def estimate_tokens(messages: list) -> int:
    return len(json.dumps(messages, ensure_ascii=False)) // CHARS_PER_TOKEN


def micro_compact(messages: list) -> list:
    """Layer 1: Replace old tool_result content with placeholders (silent, every turn)."""
    tool_result_indices = []
    for i, msg in enumerate(messages):
        if msg.get("role") == "tool":
            tool_result_indices.append(i)
        elif msg.get("role") == "user" and isinstance(msg.get("content"), list):
            for block in msg["content"]:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    tool_result_indices.append(i)
                    break

    if len(tool_result_indices) <= KEEP_RECENT:
        return messages

    to_compact = tool_result_indices[:-KEEP_RECENT]
    for idx in to_compact:
        msg = messages[idx]
        if msg.get("role") == "tool":
            if len(msg.get("content", "")) > 200:
                messages[idx]["content"] = "[Previous tool result compacted]"
        elif isinstance(msg.get("content"), list):
            for block in msg["content"]:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    if len(str(block.get("content", ""))) > 200:
                        block["content"] = "[Previous tool result compacted]"

    return messages


def auto_compact(messages: list, client, model: str, provider: str,
                 transcript_dir: str = ".transcripts") -> list:
    """Layer 2: When tokens exceed threshold, save transcript and summarize."""
    tokens = estimate_tokens(messages)
    if tokens < TOKEN_THRESHOLD:
        return messages

    _save_transcript(messages, transcript_dir)

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

    try:
        if provider == "openai":
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": summary_prompt}],
                max_tokens=1024,
            )
            summary = resp.choices[0].message.content
        else:
            resp = client.messages.create(
                model=model,
                messages=[{"role": "user", "content": summary_prompt}],
                max_tokens=1024,
            )
            summary = resp.content[0].text
    except Exception as e:
        summary = f"(auto-compact failed: {e}. Keeping last 10 messages.)"
        return messages[-10:]

    return [
        {"role": "user", "content": f"[Context compacted. Summary of previous conversation:]\n{summary}"},
        {"role": "assistant", "content": "Understood. I have the context summary. How can I help?"},
    ]


def _save_transcript(messages: list, transcript_dir: str):
    Path(transcript_dir).mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = Path(transcript_dir) / f"transcript_{ts}.json"
    try:
        with open(path, "w") as f:
            json.dump(messages, f, ensure_ascii=False, indent=2, default=str)
    except Exception:
        pass
