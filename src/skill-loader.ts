import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";

export class SkillLoader {
  private skillsDir: string;
  skills: Record<string, { meta: Record<string, string>; body: string; path: string }> = {};

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    this.scan();
  }

  private scan(): void {
    if (!existsSync(this.skillsDir)) return;
    for (const f of this.findSkillFiles(this.skillsDir).sort()) {
      const text = readFileSync(f, "utf-8");
      const [meta, body] = SkillLoader.parseFrontmatter(text);
      const name = meta.name || basename(dirname(f));
      this.skills[name] = { meta, body, path: f };
    }
  }

  private findSkillFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.findSkillFiles(fullPath));
      } else if (entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }
    return results;
  }

  static parseFrontmatter(text: string): [Record<string, string>, string] {
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/);
    if (!match) return [{}, text];
    const meta: Record<string, string> = {};
    for (const line of match[1].trim().split("\n")) {
      const idx = line.indexOf(":");
      if (idx !== -1) {
        meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    return [meta, match[2].trim()];
  }

  getDescriptions(): string {
    const names = Object.keys(this.skills);
    if (!names.length) return "(no skills available)";
    return names
      .map((name) => {
        const desc = this.skills[name].meta.description || "No description";
        return `  - ${name}: ${desc}`;
      })
      .join("\n");
  }

  getContent(name: string): string {
    const skill = this.skills[name];
    if (!skill) {
      const available = Object.keys(this.skills).join(", ");
      return `Unknown skill '${name}'. Available: ${available}`;
    }
    return `<skill name="${name}">\n${skill.body}\n</skill>`;
  }

  listNames(): string[] {
    return Object.keys(this.skills);
  }
}
