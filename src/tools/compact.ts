import { registerTool } from "./registry.js";

registerTool(
  "compact",
  "Compress conversation history to free up context space.\nUse when the conversation is getting long and you need more room.\nSaves full transcript to .transcripts/ before compressing.",
  { type: "object", properties: {} },
  async ({ agent, sessionId }) => {
    const { autoCompact, estimateTokens } = await import("../context.js");
    const session = agent.sessions.get(sessionId);
    const before = estimateTokens(session.messages);
    session.messages = await autoCompact(session.messages, agent.client, agent.provider, null, { force: true });
    const after = estimateTokens(session.messages);
    return `Context compacted: ${before.toLocaleString()} \u2192 ${after.toLocaleString()} tokens (saved ${(before - after).toLocaleString()})`;
  },
);
