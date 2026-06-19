import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { PaperExchange } from "./exchange/paper.js";
import { LiveExchange } from "./exchange/live.js";
import { ExchangeManager } from "./exchange/manager.js";
import { TOOL_DEFINITIONS } from "./tools/registry.js";
import { Soul } from "./soul.js";
import { SkillLoader } from "./skill-loader.js";
import { SessionManager } from "./session.js";
import { microCompact, autoCompact } from "./context.js";
import { buildWorldSnapshot } from "./world-snapshot.js";
import { type AgentToolDeps } from "./agent/tool-dispatch.js";
import { createAgentGraphRuntime } from "./agent/langgraph-runtime.js";
import type { AgentMessage } from "./agent/provider-step.js";
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

export class CryptoAgent {
  exchangeManager: ExchangeManager;
  soul: Soul;
  skillLoader: SkillLoader;
  sessions: SessionManager;
  memory: Memory | null = null;
  strategyStore: StrategyManager | null = null;
  provider: string;
  client: any;
  private langGraphRuntime = createAgentGraphRuntime();

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

  private createToolDeps(sessionId: string): AgentToolDeps {
    return {
      getExchange: () => this.exchange,
      getConfig: () => config,
      getMemory: () => this.memory,
      getSessionId: () => sessionId,
      getSoul: () => this.soul.profile,
      getExchangeManager: () => this.exchangeManager,
      getAgent: () => this,
      getSkillLoader: () => this.skillLoader,
      getStrategyStore: () => this.strategyStore,
    };
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
    const result = await this.langGraphRuntime.run({
      provider: this.provider,
      client: this.client,
      messages: session.messages as AgentMessage[],
      systemPrompt: sysPrompt,
      sessionId,
      callbacks,
      toolDeps: this.createToolDeps(sessionId),
    });
    session.messages = result.messages;
    return result.finalText;
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

  async close(): Promise<void> {
    await this.exchangeManager.closeAll();
  }
}
