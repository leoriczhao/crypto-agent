import pytest
from crypto_agent.sub_agents import ROLES, SubAgentRunner


def test_roles_defined():
    assert "researcher" in ROLES
    assert "trader" in ROLES
    assert "risk_officer" in ROLES


def test_role_has_system_prompt():
    for role_name, role in ROLES.items():
        assert "system" in role
        assert len(role["system"]) > 20


def test_role_has_tools():
    for role_name, role in ROLES.items():
        assert "tools" in role
        assert len(role["tools"]) >= 1


def test_researcher_has_readonly_tools():
    tools = ROLES["researcher"]["tools"]
    assert "get_price" in tools
    assert "get_news" in tools
    assert "analyze" in tools
    assert "buy" not in tools
    assert "sell" not in tools


def test_trader_has_trade_tools():
    tools = ROLES["trader"]["tools"]
    assert "buy" in tools
    assert "sell" in tools
    assert "get_portfolio" in tools
    assert "analyze" in tools


def test_risk_officer_has_risk_tools():
    tools = ROLES["risk_officer"]["tools"]
    assert "assess_risk" in tools
    assert "get_portfolio" in tools
    assert "buy" not in tools
    assert "sell" not in tools


def test_sub_agent_runner_filters_tools():
    runner = SubAgentRunner(role="researcher")
    filtered = runner.get_tool_definitions()
    names = {t["name"] for t in filtered}
    assert "get_price" in names
    assert "buy" not in names


def test_sub_agent_runner_unknown_role():
    with pytest.raises(ValueError, match="Unknown role"):
        SubAgentRunner(role="hacker")


def test_sub_agent_runner_system_prompt():
    runner = SubAgentRunner(role="trader")
    assert "trader" in runner.system_prompt.lower()


def test_sub_agent_runner_get_handlers():
    runner = SubAgentRunner(role="risk_officer")
    handlers = runner.get_tool_handlers()
    assert "assess_risk" in handlers
    assert "buy" not in handlers
