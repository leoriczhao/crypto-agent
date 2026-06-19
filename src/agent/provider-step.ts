import { TOOL_DEFINITIONS } from "../tools/registry.js";
import { anthropicMessageKwargs, openaiChatCompletionKwargs } from "../llm/provider.js";

export interface AgentToolCall {
  id: string;
  type?: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentAssistantMessage {
  role: "assistant";
  content: any;
  tool_calls?: AgentToolCall[];
}

export interface AgentToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type AgentMessage =
  | { role: "user"; content: any }
  | AgentAssistantMessage
  | AgentToolMessage
  | { role: "system"; content: string };

export interface AgentToolRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ProviderStepCallbacks {
  onDelta?: (text: string) => void;
  onToolUse?: (name: string) => void;
  signal?: AbortSignal;
}

export interface ProviderStepResult {
  message: AgentAssistantMessage;
  text: string;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Cancelled");
}

function openaiTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

export function hasToolCalls(msg: AgentAssistantMessage): boolean {
  return extractToolRequests(msg).length > 0;
}

export function extractToolRequests(msg: AgentAssistantMessage | undefined): AgentToolRequest[] {
  if (!msg) return [];
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    return msg.tool_calls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
    }));
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block: any) => block?.type === "tool_use")
      .map((block: any) => ({
        id: block.id,
        name: block.name,
        args: (block.input ?? {}) as Record<string, unknown>,
      }));
  }
  return [];
}

export function makeToolResultMessages(
  provider: string,
  outputs: Array<{ id: string; content: string }>,
): AgentMessage[] {
  if (provider === "anthropic") {
    return [{
      role: "user",
      content: outputs.map((o) => ({
        type: "tool_result",
        tool_use_id: o.id,
        content: o.content,
      })),
    }];
  }
  return outputs.map((o) => ({ role: "tool", tool_call_id: o.id, content: o.content }));
}

export async function runOpenaiStep(opts: {
  client: any;
  config: any;
  messages: AgentMessage[];
  systemPrompt: string;
  callbacks?: ProviderStepCallbacks;
}): Promise<ProviderStepResult> {
  const callbacks = opts.callbacks ?? {};
  throwIfCancelled(callbacks.signal);
  const stream = await opts.client.chat.completions.create({
    messages: [{ role: "system", content: opts.systemPrompt }, ...opts.messages],
    tools: openaiTools(),
    stream: true,
    ...openaiChatCompletionKwargs(opts.config),
  }, { signal: callbacks.signal });

  let fullContent = "";
  const tcMap: Record<number, AgentToolCall> = {};

  for await (const chunk of stream) {
    throwIfCancelled(callbacks.signal);
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      fullContent += delta.content;
      if (!callbacks.signal?.aborted) callbacks.onDelta?.(fullContent);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!tcMap[idx]) {
          tcMap[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
        }
        if (tc.id) tcMap[idx].id = tc.id;
        if (tc.function?.name) tcMap[idx].function.name += tc.function.name;
        if (tc.function?.arguments) tcMap[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  const toolCalls = Object.values(tcMap);
  const message: AgentAssistantMessage = toolCalls.length
    ? { role: "assistant", content: fullContent || null, tool_calls: toolCalls }
    : { role: "assistant", content: fullContent };
  return { message, text: fullContent };
}

export async function runAnthropicStep(opts: {
  client: any;
  config: any;
  messages: AgentMessage[];
  systemPrompt: string;
  callbacks?: ProviderStepCallbacks;
}): Promise<ProviderStepResult> {
  const callbacks = opts.callbacks ?? {};
  throwIfCancelled(callbacks.signal);
  const stream = opts.client.messages.stream({
    system: opts.systemPrompt,
    messages: opts.messages,
    tools: TOOL_DEFINITIONS,
    ...anthropicMessageKwargs(opts.config),
  }, { signal: callbacks.signal });

  let fullText = "";
  stream.on("text", (text: string) => {
    if (callbacks.signal?.aborted) return;
    fullText += text;
    callbacks.onDelta?.(fullText);
  });

  const response = await stream.finalMessage();
  throwIfCancelled(callbacks.signal);
  const text = fullText || response.content.filter((b: any) => b.text).map((b: any) => b.text).join("\n");
  return { message: { role: "assistant", content: response.content }, text };
}
