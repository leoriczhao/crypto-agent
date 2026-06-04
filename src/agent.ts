import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { PaperExchange } from "./exchange/paper.js";
import { LiveExchange } from "./exchange/live.js";
import { ExchangeManager } from "./exchange/manager.js";
import { TOOL_DEFINITIONS, TOOL_HANDLERS, TOOL_DEPS } from "./tools/registry.js";
import { Soul } from "./soul.js";
import { SkillLoader } from "./skill-loader.js";
import { SessionManager } from "./session.js";
import { microCompact, autoCompact } from "./context.js";
import { openaiChatCompletionKwargs, anthropicMessageKwargs } from "./llm/provider.js";
import { buildWorldSnapshot } from "./world-snapshot.js";
import type { Memory } from "./memory.js";
import type { StrategyManager } from "./strategy/manager.js";
import "./tools/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ChatCallbacks {
  onDelta?: (text: string) => void;
  onToolUse?: (name: string) => void;
  signal?: AbortSignal;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Cancelled");
}
const SKILLS_DIR = join(__dirname, "..", "skills");

const SYSTEM_BASE = `You are a crypto trading agent operating on real exchanges via ccxt.

Decision framework:
1. Observe — check price, positions, and risk BEFORE acting
2. Analyze — use technical indicators and news to form a view
3. Decide — synthesize all data, state your reasoning, then act
4. Report — always state what you did and why

Rules:
- Never trade without checking current positions and risk first
- State PAPER or LIVE mode before any trade execution
- When uncertain, gather more data rather than guess
- Use load_skill for domain knowledge you're unsure about
- Symbols are formatted as BTC/USDT, ETH/USDT, etc.
`;

function openaiTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

export class CryptoAgent {
  exchangeManager: ExchangeManager;
  soul: Soul;
  skillLoader: SkillLoader;
  sessions: SessionManager;
  memory: Memory | null = null;
  strategyStore: StrategyManager | null = null;
  provider: string;
  client: any;

  constructor() {
    this.exchangeManager = new ExchangeManager();
    const defaultEx = config.paperTrading
      ? new PaperExchange(config.defaultExchange, config.initialBalance, config.httpsProxy)
      : new LiveExchange(config.defaultExchange, config.exchangeApiKey, config.exchangeSecret, config.exchangePassword, config.httpsProxy);
    this.exchangeManager.register(config.defaultExchange, defaultEx);

    for (const [exId, creds] of Object.entries(config.extraExchanges)) {
      const ex = config.paperTrading
        ? new PaperExchange(exId, config.initialBalance, config.httpsProxy)
        : new LiveExchange(exId, creds.api_key ?? "", creds.secret ?? "", "", config.httpsProxy);
      this.exchangeManager.register(exId, ex);
    }

    this.soul = new Soul(config.tradingSoul);
    this.skillLoader = new SkillLoader(SKILLS_DIR);
    this.sessions = new SessionManager();
    this.provider = config.llmProvider;
    this.client = null;
  }

  async initClient(): Promise<void> {
    if (this.client) return;
    if (this.provider === "openai") {
      const { default: OpenAI } = await import("openai");
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiBaseUrl || undefined,
      });
    } else {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.client = new Anthropic({
        apiKey: config.apiKey,
        baseURL: config.apiBaseUrl || undefined,
      });
    }
  }

  get exchange() {
    return this.exchangeManager.active;
  }

  get systemPrompt(): string {
    const skillsSection = this.skillLoader.getDescriptions();
    return SYSTEM_BASE + `\nSkills available (use load_skill to access):\n${skillsSection}` + this.soul.systemModifier;
  }

  private async dispatchTool(
    name: string,
    inputs: Record<string, any>,
    sessionId: string,
  ): Promise<string> {
    const handler = TOOL_HANDLERS[name];
    if (!handler) return `Unknown tool: ${name}`;

    const deps = TOOL_DEPS[name] ?? [];
    const depMap: Record<string, () => any> = {
      exchange: () => this.exchange,
      config: () => config,
      memory: () => this.memory,
      sessionId: () => sessionId,
      soul: () => this.soul.profile,
      exchange_manager: () => this.exchangeManager,
      agent: () => this,
      skill_loader: () => this.skillLoader,
      strategy_store: () => this.strategyStore,
    };
    const resolved: Record<string, any> = {};
    for (const d of deps) resolved[d] = depMap[d]?.();
    return handler({ ...resolved, ...inputs });
  }

  private async buildFullSystemPrompt(): Promise<string> {
    let prompt = this.systemPrompt;
    if (config.worldSnapshotEnabled) {
      try {
        const snapshot = await buildWorldSnapshot(this.exchange, {
          paperTrading: config.paperTrading,
          strategyStore: this.strategyStore,
        });
        prompt += `\n\n## Current State\n${snapshot}`;
      } catch {
        // Snapshot failure is non-fatal — LLM can still use tools to observe
      }
    }
    return prompt;
  }

  async chatInSession(
    sessionId: string,
    userMessage: string,
    callbacks: ChatCallbacks = {},
  ): Promise<string> {
    await this.initClient();
    throwIfCancelled(callbacks.signal);
    const session = this.sessions.get(sessionId);
    session.messages.push({ role: "user", content: userMessage });
    session.messages = microCompact(session.messages);
    session.messages = await autoCompact(session.messages, this.client, this.provider, null, {
      signal: callbacks.signal,
    });
    throwIfCancelled(callbacks.signal);
    session.lastActiveAt = new Date();

    const sysPrompt = await this.buildFullSystemPrompt();
    throwIfCancelled(callbacks.signal);
    if (this.provider === "openai") return this.streamOpenai(session.messages, sessionId, callbacks, sysPrompt);
    return this.streamAnthropic(session.messages, sessionId, callbacks, sysPrompt);
  }

  async chat(userMessage: string): Promise<string> {
    return this.chatInSession(this.sessions.activeId, userMessage);
  }

  async chatStream(
    userMessage: string,
    callbacks: ChatCallbacks = {},
  ): Promise<string> {
    return this.chatInSession(this.sessions.activeId, userMessage, callbacks);
  }

  private async streamOpenai(
    messages: any[],
    sessionId: string,
    cb: ChatCallbacks,
    sysPrompt?: string,
  ): Promise<string> {
    const tools = openaiTools();
    const baseKw = openaiChatCompletionKwargs(config);
    const systemContent = sysPrompt ?? this.systemPrompt;

    while (true) {
      throwIfCancelled(cb.signal);
      const stream = await this.client.chat.completions.create({
        messages: [{ role: "system", content: systemContent }, ...messages],
        tools,
        stream: true,
        ...baseKw,
      }, { signal: cb.signal });

      let fullContent = "";
      const tcMap: Record<number, { id: string; function: { name: string; arguments: string } }> = {};

      for await (const chunk of stream) {
        throwIfCancelled(cb.signal);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          fullContent += delta.content;
          if (!cb.signal?.aborted) cb.onDelta?.(fullContent);
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!tcMap[idx]) tcMap[idx] = { id: "", function: { name: "", arguments: "" } };
            if (tc.id) tcMap[idx].id = tc.id;
            if (tc.function?.name) tcMap[idx].function.name += tc.function.name;
            if (tc.function?.arguments) tcMap[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      const toolCalls = Object.values(tcMap);
      if (!toolCalls.length) {
        messages.push({ role: "assistant", content: fullContent });
        return fullContent;
      }

      messages.push({
        role: "assistant",
        content: fullContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of toolCalls) {
        throwIfCancelled(cb.signal);
        cb.onToolUse?.(tc.function.name);
        const args = JSON.parse(tc.function.arguments);
        const output = await this.dispatchTool(tc.function.name, args, sessionId);
        throwIfCancelled(cb.signal);
        messages.push({ role: "tool", tool_call_id: tc.id, content: output });
      }
    }
  }

  private async streamAnthropic(
    messages: any[],
    sessionId: string,
    cb: ChatCallbacks,
    sysPrompt?: string,
  ): Promise<string> {
    const baseKw = anthropicMessageKwargs(config);
    const systemContent = sysPrompt ?? this.systemPrompt;

    while (true) {
      throwIfCancelled(cb.signal);
      const stream = this.client.messages.stream({
        system: systemContent,
        messages,
        tools: TOOL_DEFINITIONS,
        ...baseKw,
      }, { signal: cb.signal });

      let fullText = "";
      stream.on("text", (text: string) => {
        if (cb.signal?.aborted) return;
        fullText += text;
        cb.onDelta?.(fullText);
      });

      const response = await stream.finalMessage();
      throwIfCancelled(cb.signal);
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        return fullText || response.content.filter((b: any) => b.text).map((b: any) => b.text).join("\n");
      }

      const results: any[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          throwIfCancelled(cb.signal);
          cb.onToolUse?.(block.name);
          const output = await this.dispatchTool(block.name, block.input, sessionId);
          throwIfCancelled(cb.signal);
          results.push({ type: "tool_result", tool_use_id: block.id, content: output });
        }
      }
      messages.push({ role: "user", content: results });
    }
  }

  async close(): Promise<void> {
    await this.exchangeManager.closeAll();
  }
}
