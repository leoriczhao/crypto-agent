import chalk from "chalk";

export function renderMd(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  for (const raw of lines) {
    if (raw.startsWith("```")) { inCode = !inCode; out.push(inCode ? chalk.dim("┌──") : chalk.dim("└──")); continue; }
    if (inCode) { out.push(chalk.dim("│ ") + chalk.gray(raw)); continue; }
    const h1 = raw.match(/^# (.+)/); if (h1) { out.push("\n" + chalk.bold.underline(inlineFmt(h1[1])) + "\n"); continue; }
    const h2 = raw.match(/^## (.+)/); if (h2) { out.push("\n" + chalk.bold.yellow(inlineFmt(h2[1]))); continue; }
    const h3 = raw.match(/^### (.+)/); if (h3) { out.push(chalk.bold.cyan(inlineFmt(h3[1]))); continue; }
    if (/^---+$/.test(raw.trim())) { out.push(chalk.dim("─".repeat(40))); continue; }
    out.push(inlineFmt(raw).replace(/^(\s*)[-*] /, "$1• "));
  }
  return out.join("\n");
}

export function inlineFmt(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, t) => chalk.italic(t))
    .replace(/`(.+?)`/g, (_, t) => chalk.inverse(` ${t} `));
}

export function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

export function displayWidth(str: string): number {
  let w = 0;
  for (const ch of stripAnsi(str)) {
    const cp = ch.codePointAt(0)!;
    const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3040 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x2fa1f);
    w += wide ? 2 : 1;
  }
  return w;
}
