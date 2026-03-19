import pytest
from crypto_agent.context import micro_compact, estimate_tokens, KEEP_RECENT


def _make_messages(n_tool_results: int) -> list:
    msgs = []
    for i in range(n_tool_results):
        msgs.append({"role": "user", "content": f"Question {i}"})
        msgs.append({"role": "assistant", "content": f"Let me check..."})
        msgs.append({"role": "tool", "tool_call_id": f"tc_{i}", "content": "x" * 500})
    return msgs


def test_micro_compact_keeps_recent():
    msgs = _make_messages(6)
    result = micro_compact(msgs)
    tool_msgs = [m for m in result if m.get("role") == "tool"]
    compacted = [m for m in tool_msgs if "compacted" in m.get("content", "")]
    kept = [m for m in tool_msgs if "compacted" not in m.get("content", "")]
    assert len(compacted) == 3
    assert len(kept) == KEEP_RECENT


def test_micro_compact_noop_when_few():
    msgs = _make_messages(2)
    original = [m.get("content") for m in msgs if m.get("role") == "tool"]
    result = micro_compact(msgs)
    after = [m.get("content") for m in result if m.get("role") == "tool"]
    assert original == after


def test_micro_compact_skips_short_content():
    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "tool", "tool_call_id": "tc_0", "content": "short"},
        {"role": "tool", "tool_call_id": "tc_1", "content": "also short"},
        {"role": "tool", "tool_call_id": "tc_2", "content": "x" * 500},
        {"role": "tool", "tool_call_id": "tc_3", "content": "y" * 500},
        {"role": "tool", "tool_call_id": "tc_4", "content": "z" * 500},
    ]
    result = micro_compact(msgs)
    assert result[1]["content"] == "short"
    assert result[2]["content"] == "also short"


def test_estimate_tokens():
    msgs = [{"role": "user", "content": "hello world"}]
    tokens = estimate_tokens(msgs)
    assert tokens > 0
    assert isinstance(tokens, int)


def test_estimate_tokens_grows_with_content():
    small = estimate_tokens([{"role": "user", "content": "hi"}])
    large = estimate_tokens([{"role": "user", "content": "x" * 10000}])
    assert large > small


def test_micro_compact_anthropic_format():
    msgs = [
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "id_0", "content": "x" * 500}
        ]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "id_1", "content": "y" * 500}
        ]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "id_2", "content": "z" * 500}
        ]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "id_3", "content": "w" * 500}
        ]},
    ]
    result = micro_compact(msgs)
    assert "compacted" in str(result[0]["content"][0]["content"])
    assert result[3]["content"][0]["content"] == "w" * 500
