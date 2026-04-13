import { registerTool } from "./registry.js";

registerTool(
  "load_skill",
  "Load specialized trading knowledge on demand.\nSkills contain detailed domain expertise (strategy rules, exchange docs, risk limits).\nAlways load the relevant skill before tackling unfamiliar topics.",
  {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name to load (see available skills in system prompt)" },
    },
    required: ["name"],
  },
  async ({ skill_loader, name }) => {
    return skill_loader.getContent(name);
  },
);
