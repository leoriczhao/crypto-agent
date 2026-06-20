import type { AgentMessage } from "./provider-step.js";

const CURRENT_STATE_SUFFIX =
  "\n\nUse this current-state block as ephemeral context for this turn. It is not conversation history.";

function currentStateBlock(snapshot: string): string {
  return `\n\n## Current State\n${snapshot.trim()}${CURRENT_STATE_SUFFIX}`;
}

export function injectEphemeralCurrentState(
  messages: AgentMessage[],
  snapshot: string | null | undefined,
): {
  messages: AgentMessage[];
  restore: (resultMessages: AgentMessage[]) => AgentMessage[];
} {
  if (!snapshot?.trim()) {
    return { messages, restore: (resultMessages) => resultMessages };
  }

  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  const block = currentStateBlock(snapshot);

  if (last?.role === "user" && typeof last.content === "string") {
    const injected = [...messages];
    injected[lastIndex] = { ...last, content: `${last.content}${block}` };

    return {
      messages: injected,
      restore(resultMessages) {
        const restored = [...resultMessages];
        if (restored[lastIndex]?.role === "user") restored[lastIndex] = last;
        return restored;
      },
    };
  }

  const appended: AgentMessage = { role: "user", content: block.trim() };
  const appendedIndex = messages.length;

  return {
    messages: [...messages, appended],
    restore(resultMessages) {
      return resultMessages.filter((_, index) => index !== appendedIndex);
    },
  };
}
