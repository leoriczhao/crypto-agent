import { describe, test, expect, vi, beforeEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SkillLoader } from "../src/skill-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", "skills");

describe("SkillLoader", () => {
  test("finds skills", () => {
    const loader = new SkillLoader(SKILLS_DIR);
    expect(Object.keys(loader.skills).length).toBeGreaterThanOrEqual(4);
  });

  test("list names", () => {
    const loader = new SkillLoader(SKILLS_DIR);
    const names = loader.listNames();
    expect(names).toContain("trading-strategies");
    expect(names).toContain("exchange-guide");
    expect(names).toContain("risk-management");
    expect(names).toContain("technical-analysis");
  });

  test("descriptions not empty", () => {
    const loader = new SkillLoader(SKILLS_DIR);
    const desc = loader.getDescriptions();
    expect(desc).toContain("trading-strategies");
    expect(desc.length).toBeGreaterThan(100);
  });

  test("get content returns skill xml", () => {
    const loader = new SkillLoader(SKILLS_DIR);
    const content = loader.getContent("risk-management");
    expect(content).toContain('<skill name="risk-management">');
    expect(content).toContain("Position Sizing");
  });

  test("get content unknown skill", () => {
    const loader = new SkillLoader(SKILLS_DIR);
    const result = loader.getContent("nonexistent");
    expect(result).toContain("Unknown skill");
  });

  test("empty dir yields no skills", () => {
    const loader = new SkillLoader(join(tmpdir(), `nope-${randomUUID()}`));
    expect(loader.skills).toEqual({});
    expect(loader.getDescriptions()).toBe("(no skills available)");
  });

  test("frontmatter parsing", () => {
    const loader = new SkillLoader(SKILLS_DIR);
    const skill = loader.skills["trading-strategies"];
    expect(skill.meta.name).toBe("trading-strategies");
    expect(skill.meta).toHaveProperty("description");
    expect(skill.body.length).toBeGreaterThan(100);
  });
});

describe("load_skill tool", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("loads skill content via tool handler", async () => {
    await import("../src/tools/load-skill.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const loader = new SkillLoader(SKILLS_DIR);
    const result = await TOOL_HANDLERS.load_skill({
      skill_loader: loader,
      name: "exchange-guide",
    });
    expect(result).toContain("Gate.io");
    expect(result).toContain("<skill");
  });
});
