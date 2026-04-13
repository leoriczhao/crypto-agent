import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { compactSummaryOpenaiKwargs, compactSummaryAnthropicKwargs } from "./llm/provider.js";

export function estimateTokens(messages: any[]): number {
  return Math.floor(JSON.stringify(messages).length / config.contextCharsPerToken);
}

export function microCompact(messages: any[]): any[] {
  if (!config.microCompactEnabled) return messages;
  const keepRecent = Math.max(0, config.microCompactKeepRecent);
  const minLen = config.microCompactMinContentLen;

  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "tool") {
      toolResultIndices.push(i);
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "object" && block?.type === "tool_result") {
          toolResultIndices.push(i);
          break;
        }
      }
    }
  }

  if (toolResultIndices.length <= keepRecent) return messages;

  const toCompact = keepRecent === 0 ? toolResultIndices : toolResultIndices.slice(0, -keepRecent);

  for (const idx of toCompact) {
    const msg = messages[idx];
    if (msg.role === "tool") {
      if ((msg.content?.length ?? 0) > minLen) {
        messages[idx].content = "[Previous tool result compacted]";
      }
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "object" && block?.type === "tool_result") {
          if (String(block.content ?? "").length > minLen) {
            block.content = "[Previous tool result compacted]";
          }
        }
      }
    }
  }

  return messages;
}

export async function autoCompact(
  messages: any[],
  client: any,
  provider: string,
  transcriptDir?: string | null,
  opts?: { force?: boolean; sessionId?: string },
): Promise<any[]> {
  const force = opts?.force ?? false;
  if (!force && !config.autoCompactEnabled) return messages;

  const tokens = estimateTokens(messages);
  if (!force && tokens < config.autoCompactTokenThreshold) return messages;

  const td = transcriptDir ?? config.autoCompactTranscriptDir;
  saveTranscript(messages, td, opts?.sessionId);

  const textParts: string[] = [];
  for (const msg of messages) {
    const role = msg.role ?? "";
    const content = msg.content;
    if (typeof content === "string" && content) {
      textParts.push(`[${role}] ${content.slice(0, 500)}`);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "object") {
          const text = block.text ?? block.content ?? "";
          if (text) textParts.push(`[${role}] ${String(text).slice(0, 300)}`);
        }
      }
    }
  }

  const conversationText = textParts.slice(-40).join("\n");
  const summaryPrompt =
    "Summarize this trading agent conversation concisely. " +
    "Preserve: current positions, pending orders, active strategies, " +
    "key price levels mentioned, and any decisions made. " +
    "Keep it under 500 words.\n\n" +
    conversationText;

  let summary: string;
  try {
    if (provider === "openai") {
      const kwargs = compactSummaryOpenaiKwargs(config);
      const resp = await client.chat.completions.create({
        messages: [{ role: "user", content: summaryPrompt }],
        ...kwargs,
      });
      summary = resp.choices[0].message.content;
    } else {
      const kwargs = compactSummaryAnthropicKwargs(config);
      const resp = await client.messages.create({
        messages: [{ role: "user", content: summaryPrompt }],
        ...kwargs,
      });
      summary = resp.content[0].text;
    }
  } catch (e: any) {
    summary = `(auto-compact failed: ${e.message ?? e}. Keeping last 10 messages.)`;
    return messages.slice(-10);
  }

  return [
    { role: "user", content: `[Context compacted. Summary of previous conversation:]\n${summary}` },
    { role: "assistant", content: "Understood. I have the context summary. How can I help?" },
  ];
}

function saveTranscript(messages: any[], transcriptDir: string, sessionId?: string): void {
  try {
    if (!existsSync(transcriptDir)) mkdirSync(transcriptDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
    const prefix = sessionId ? `${sessionId.slice(0, 8)}_` : "";
    const path = join(transcriptDir, `transcript_${prefix}${ts}.json`);
    writeFileSync(path, JSON.stringify(messages, null, 2));
  } catch {
    // silently ignore
  }
}

export const KEEP_RECENT = 3;
