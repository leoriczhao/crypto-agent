import { registerTool } from "./registry.js";

registerTool(
  "switch_soul",
  "Switch trading personality. Options: conservative (\u4fdd\u5b88), balanced (\u5747\u8861), aggressive (\u6fc0\u8fdb). Shows current personality if none specified.",
  {
    type: "object",
    properties: {
      personality: { type: "string", enum: ["conservative", "balanced", "aggressive"] },
    },
    required: [],
  },
  async ({ soul, personality = "" }) => {
    try {
      if (!personality) {
        const profile = soul.profile;
        const souls = soul.constructor.listSouls ? soul.constructor.listSouls() : [];
        const active = soul.soulId;
        const lines = [
          `Current Personality: ${soul.name}`,
          "=".repeat(40),
          `Description:     ${profile.description}`,
          `Max Position:    ${profile.max_position_pct}% of portfolio`,
          `Stop-Loss:       ${profile.stop_loss_pct}%`,
          `Preferred:       ${profile.preferred_assets.join(", ")}`,
          "",
          "Available Personalities:",
          "=".repeat(50),
        ];
        for (const s of souls) {
          const marker = s.id === active ? " \u2190 active" : "";
          lines.push(`  \u2022 ${s.name}${marker}`);
          lines.push(`    ${s.description}`);
        }
        return lines.join("\n");
      }

      const oldName = soul.name;
      soul.switch(personality);
      const profile = soul.profile;
      return [
        `Personality switched: ${oldName} \u2192 ${soul.name}`,
        "=".repeat(40),
        `Description:     ${profile.description}`,
        `Max Position:    ${profile.max_position_pct}% of portfolio`,
        `Stop-Loss:       ${profile.stop_loss_pct}%`,
        `Preferred:       ${profile.preferred_assets.join(", ")}`,
      ].join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
