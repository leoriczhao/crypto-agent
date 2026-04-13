import { describe, test, expect, vi, beforeEach } from "vitest";
import { Soul, SOULS, DEFAULT_SOUL } from "../src/soul.js";

describe("Soul", () => {
  test("default soul is balanced", () => {
    const s = new Soul();
    expect(s.soulId).toBe(DEFAULT_SOUL);
    expect(s.soulId).toBe("balanced");
  });

  test("all souls defined", () => {
    expect("conservative" in SOULS).toBe(true);
    expect("balanced" in SOULS).toBe(true);
    expect("aggressive" in SOULS).toBe(true);
  });

  test("soul profile has required fields", () => {
    for (const [soulId, profile] of Object.entries(SOULS)) {
      expect(profile).toHaveProperty("name");
      expect(profile).toHaveProperty("description");
      expect(profile).toHaveProperty("system_modifier");
      expect(profile).toHaveProperty("max_position_pct");
      expect(profile).toHaveProperty("stop_loss_pct");
      expect(profile).toHaveProperty("preferred_assets");
    }
  });

  test("switch personality", () => {
    const s = new Soul("balanced");
    s.switch("aggressive");
    expect(s.soulId).toBe("aggressive");
    expect(s.systemModifier).toContain("AGGRESSIVE");
  });

  test("switch to unknown soul throws", () => {
    const s = new Soul();
    expect(() => s.switch("yolo")).toThrow(/Unknown soul/);
  });

  test("init with unknown soul throws", () => {
    expect(() => new Soul("yolo")).toThrow(/Unknown soul/);
  });

  test("system modifier not empty", () => {
    for (const soulId of Object.keys(SOULS)) {
      const s = new Soul(soulId);
      expect(s.systemModifier.length).toBeGreaterThan(50);
    }
  });

  test("conservative name contains 保守", () => {
    const s = new Soul("conservative");
    expect(s.name).toContain("保守");
  });

  test("listSouls returns all 3", () => {
    const result = Soul.listSouls();
    expect(result).toHaveLength(3);
    const ids = new Set(result.map((s) => s.id));
    expect(ids).toEqual(new Set(["conservative", "balanced", "aggressive"]));
  });

  test("conservative stricter than aggressive", () => {
    expect(SOULS.conservative.max_position_pct).toBeLessThan(SOULS.aggressive.max_position_pct);
    expect(SOULS.conservative.stop_loss_pct).toBeLessThan(SOULS.aggressive.stop_loss_pct);
  });
});

describe("switch_soul tool", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("shows current personality status", async () => {
    await import("../src/tools/switch-soul.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const s = new Soul("aggressive");
    const result = await TOOL_HANDLERS.switch_soul({ soul: s });
    expect(result).toContain("Aggressive");
    expect(result).toContain("激进");
  });

  test("switches personality", async () => {
    await import("../src/tools/switch-soul.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const s = new Soul("balanced");
    const result = await TOOL_HANDLERS.switch_soul({ soul: s, personality: "conservative" });
    expect(result).toContain("Conservative");
    expect(s.soulId).toBe("conservative");
  });

  test("lists all personalities", async () => {
    await import("../src/tools/switch-soul.js");
    const { TOOL_HANDLERS } = await import("../src/tools/registry.js");
    const s = new Soul();
    const result = await TOOL_HANDLERS.switch_soul({ soul: s });
    expect(result.toLowerCase()).toContain("conservative");
    expect(result.toLowerCase()).toContain("balanced");
    expect(result.toLowerCase()).toContain("aggressive");
  });
});
