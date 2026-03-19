import pytest
from crypto_agent.soul import Soul, SOULS, DEFAULT_SOUL


def test_default_soul():
    s = Soul()
    assert s.soul_id == DEFAULT_SOUL
    assert s.soul_id == "balanced"


def test_all_souls_defined():
    assert "conservative" in SOULS
    assert "balanced" in SOULS
    assert "aggressive" in SOULS


def test_soul_profile_fields():
    for soul_id, profile in SOULS.items():
        assert "name" in profile, f"{soul_id} missing name"
        assert "description" in profile, f"{soul_id} missing description"
        assert "system_modifier" in profile, f"{soul_id} missing system_modifier"
        assert "max_position_pct" in profile, f"{soul_id} missing max_position_pct"
        assert "stop_loss_pct" in profile, f"{soul_id} missing stop_loss_pct"
        assert "preferred_assets" in profile, f"{soul_id} missing preferred_assets"


def test_soul_switch():
    s = Soul("balanced")
    s.switch("aggressive")
    assert s.soul_id == "aggressive"
    assert "AGGRESSIVE" in s.system_modifier


def test_soul_switch_unknown_raises():
    s = Soul()
    with pytest.raises(ValueError, match="Unknown soul"):
        s.switch("yolo")


def test_soul_init_unknown_raises():
    with pytest.raises(ValueError, match="Unknown soul"):
        Soul("yolo")


def test_soul_system_modifier_not_empty():
    for soul_id in SOULS:
        s = Soul(soul_id)
        assert len(s.system_modifier) > 50


def test_soul_name():
    s = Soul("conservative")
    assert "保守" in s.name


def test_list_souls():
    result = Soul.list_souls()
    assert len(result) == 3
    ids = {s["id"] for s in result}
    assert ids == {"conservative", "balanced", "aggressive"}


def test_conservative_stricter_than_aggressive():
    assert SOULS["conservative"]["max_position_pct"] < SOULS["aggressive"]["max_position_pct"]
    assert SOULS["conservative"]["stop_loss_pct"] < SOULS["aggressive"]["stop_loss_pct"]


@pytest.mark.asyncio
async def test_soul_tool_status():
    from crypto_agent.tools.soul import handle_soul
    s = Soul("aggressive")
    result = await handle_soul(soul=s, action="status")
    assert "Aggressive" in result
    assert "激进" in result


@pytest.mark.asyncio
async def test_soul_tool_switch():
    from crypto_agent.tools.soul import handle_soul
    s = Soul("balanced")
    result = await handle_soul(soul=s, action="switch", personality="conservative")
    assert "Conservative" in result
    assert s.soul_id == "conservative"


@pytest.mark.asyncio
async def test_soul_tool_list():
    from crypto_agent.tools.soul import handle_soul
    s = Soul()
    result = await handle_soul(soul=s, action="list")
    assert "conservative" in result.lower()
    assert "balanced" in result.lower()
    assert "aggressive" in result.lower()


@pytest.mark.asyncio
async def test_soul_tool_switch_missing_personality():
    from crypto_agent.tools.soul import handle_soul
    s = Soul()
    result = await handle_soul(soul=s, action="switch")
    assert "Error" in result
