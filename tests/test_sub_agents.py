import pytest
from crypto_agent.sub_agents import ROLES, SubAgentRunner


def test_roles_defined():
    assert "researcher" in ROLES
    assert "trader" in ROLES
    assert "risk_officer" in ROLES


def test_role_has_system_prompt():
    for role_name, role in ROLES.items():
        assert "system" in role, f"{role_name} missing system prompt"
        assert len(role["system"]) > 20


def test_role_has_tools():
    for role_name, role in ROLES.items():
        assert "tools" in role, f"{role_name} missing tools list"
        assert len(role["tools"]) >= 1


def test_researcher_has_readonly_tools():
    tools = ROLES["researcher"]["tools"]
    assert "market_data" in tools
    assert "news_feed" in tools
    assert "execute_trade" not in tools


def test_trader_has_trade_tools():
    tools = ROLES["trader"]["tools"]
    assert "execute_trade" in tools
    assert "market_data" in tools
    assert "strategy" in tools


def test_risk_officer_has_risk_tools():
    tools = ROLES["risk_officer"]["tools"]
    assert "risk_check" in tools
    assert "portfolio" in tools
    assert "execute_trade" not in tools


def test_sub_agent_runner_filters_tools():
    runner = SubAgentRunner(role="researcher")
    filtered = runner.get_tool_definitions()
    names = {t["name"] for t in filtered}
    assert "market_data" in names
    assert "execute_trade" not in names


def test_sub_agent_runner_unknown_role():
    with pytest.raises(ValueError, match="Unknown role"):
        SubAgentRunner(role="hacker")


def test_sub_agent_runner_system_prompt():
    runner = SubAgentRunner(role="trader")
    assert "trader" in runner.system_prompt.lower()


def test_sub_agent_runner_get_handlers():
    runner = SubAgentRunner(role="risk_officer")
    handlers = runner.get_tool_handlers()
    assert "risk_check" in handlers
    assert "execute_trade" not in handlers
