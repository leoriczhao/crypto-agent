import pytest
from pathlib import Path
from crypto_agent.skill_loader import SkillLoader


SKILLS_DIR = Path(__file__).parent.parent / "skills"


def test_skill_loader_finds_skills():
    loader = SkillLoader(SKILLS_DIR)
    assert len(loader.skills) >= 4


def test_skill_loader_names():
    loader = SkillLoader(SKILLS_DIR)
    names = loader.list_names()
    assert "trading-strategies" in names
    assert "exchange-guide" in names
    assert "risk-management" in names
    assert "technical-analysis" in names


def test_skill_descriptions_not_empty():
    loader = SkillLoader(SKILLS_DIR)
    desc = loader.get_descriptions()
    assert "trading-strategies" in desc
    assert len(desc) > 100


def test_skill_get_content():
    loader = SkillLoader(SKILLS_DIR)
    content = loader.get_content("risk-management")
    assert "<skill name=\"risk-management\">" in content
    assert "Position Sizing" in content


def test_skill_get_content_unknown():
    loader = SkillLoader(SKILLS_DIR)
    result = loader.get_content("nonexistent")
    assert "Unknown skill" in result


def test_skill_loader_empty_dir(tmp_path):
    loader = SkillLoader(tmp_path / "nope")
    assert loader.skills == {}
    assert loader.get_descriptions() == "(no skills available)"


def test_skill_frontmatter_parsing():
    loader = SkillLoader(SKILLS_DIR)
    skill = loader.skills["trading-strategies"]
    assert skill["meta"]["name"] == "trading-strategies"
    assert "description" in skill["meta"]
    assert len(skill["body"]) > 100


@pytest.mark.asyncio
async def test_load_skill_tool():
    from crypto_agent.tools.load_skill import handle_load_skill
    loader = SkillLoader(SKILLS_DIR)
    result = await handle_load_skill(skill_loader=loader, name="exchange-guide")
    assert "Gate.io" in result
    assert "<skill" in result
