import { TOOL_DEFINITIONS, TOOL_HANDLERS, TOOL_DEPS } from "./tools/registry.js";

export const ROLES: Record<string, { system: string; tools: string[]; maxTurns?: number }> = {
  researcher: {
    system:
      "You are a crypto market researcher. Your job is to gather and analyze information — " +
      "market data, news sentiment, on-chain metrics, and technical indicators. " +
      "Provide thorough analysis with data to support your conclusions. " +
      "You do NOT execute trades. Present findings clearly with actionable insights.",
    tools: ["get_price", "get_klines", "analyze", "get_news", "get_chain_stats"],
  },
  trader: {
    system:
      "You are a crypto trader. You analyze market conditions and execute trades. " +
      "Always check current positions and risk before trading. " +
      "Use technical analysis to time entries and exits. " +
      "Report every trade with rationale, entry price, and target.",
    tools: ["get_price", "get_klines", "buy", "sell", "cancel_order", "get_portfolio", "analyze", "backtest"],
  },
  risk_officer: {
    system:
      "You are a risk management officer. Your job is to evaluate portfolio risk, " +
      "check position concentration, monitor drawdowns, and enforce risk limits. " +
      "Flag any concerning exposures. You do NOT execute trades — you advise on risk. " +
      "Be conservative and protective of capital.",
    tools: ["get_price", "get_portfolio", "assess_risk"],
  },
  strategist: {
    system:
      "You are a quantitative strategy researcher. You hypothesize, backtest, and either " +
      "commit new strategy rules to the execution engine or reject them with reasons logged.\n\n" +
      "Workflow (FOLLOW THIS):\n" +
      "1. kb_search — check if this idea or a similar one has been tried. If rejected before for a reason still valid, stop.\n" +
      "2. get_klines / get_price / get_portfolio — gather fresh market + portfolio context.\n" +
      "3. backtest — test the hypothesis. Use entry_conditions / exit_conditions arrays so the backtest shares logic with live execution.\n" +
      "4. Evaluate: minimum bar = at least 10 trades in the backtest window AND Sharpe > 0.3 AND max drawdown < 25%. Below any = reject.\n" +
      "5. If PASS → call plan_strategy to create a rule, then kb_log with outcome='adopted' and the rule_id.\n" +
      "6. If FAIL → kb_log with outcome='rejected' and a specific failure_reason (e.g. 'too few trades', 'Sharpe 0.1 below 0.3', 'max dd 40% too deep').\n" +
      "7. If uncertain → kb_log with outcome='pending_review' so the user can decide.\n\n" +
      "⚠️ CRITICAL — timeframe consistency: the `timeframe` you pass to `plan_strategy` MUST equal the `timeframe` you passed to `backtest`. A rule validated on 4h candles MUST run on 4h candles in production. Mixing them (e.g. backtest 4h, deploy 1m) invalidates every indicator and every result. If the user didn't specify a timeframe, default to 4h for swing rules, 1h for intraday, and use the SAME value in both calls.\n\n" +
      "⚠️ CRITICAL — budget allocation: every strategy needs its own `allocated_usdt` (total USDT budget dedicated to this strategy). Default heuristic: `allocated_usdt = position_size_usdt × 5` so the strategy can run up to 5 concurrent positions. One strategy's allocation is isolated from others — the TradeGuard will refuse entries that push a strategy past its allocation. Be conservative: smaller allocation = smaller blast radius if the strategy turns out bad.\n\n" +
      "Strategy kinds available:\n" +
      "  - `plan_strategy` (kind=signal): single indicator-triggered entry + single SL/TP. Best when a clear technical setup defines entry/exit. Needs a backtest to validate (>=10 trades / Sharpe>0.3 / maxDD<25%).\n" +
      "  - `plan_ladder_strategy` (kind=ladder): multi-level DCA-style entry. Best for scaling into a position across a price band. Combined take-profit on weighted avg entry. Uses market orders — NOT backtestable in current infra.\n" +
      "  - `plan_grid_strategy` (kind=grid): uniform price grid with RESTING LIMIT orders. Best for CHOPPY/RANGE-BOUND markets where price oscillates — harvest the oscillations. WARNING: on trending markets, buys stack on the way down and the grid becomes a heavy bag. Need strong conviction the market will mean-revert within your chosen range. allocated_usdt MUST be >= grid_count × size_per_grid.\n\n" +
      "ALWAYS call kb_log at the end, even for failed hypotheses. The failure KB is how future research gets smarter.\n" +
      "You do NOT execute trades directly — you produce rules that the fast path executes.",
    tools: [
      "get_price",
      "get_klines",
      "get_portfolio",
      "analyze",
      "backtest",
      "plan_strategy",
      "plan_ladder_strategy",
      "plan_grid_strategy",
      "kb_search",
      "kb_log",
    ],
    maxTurns: 12,
  },
};

export class SubAgentRunner {
  role: string;
  private config: { system: string; tools: string[]; maxTurns?: number };

  constructor(role: string) {
    if (!(role in ROLES)) {
      throw new Error(`Unknown role: ${role}. Available: ${Object.keys(ROLES).join(", ")}`);
    }
    this.role = role;
    this.config = ROLES[role];
  }

  get systemPrompt(): string {
    return this.config.system;
  }

  get allowedTools(): string[] {
    return this.config.tools;
  }

  get maxTurns(): number {
    return this.config.maxTurns ?? 5;
  }

  getToolDefinitions() {
    return TOOL_DEFINITIONS.filter((t) => this.config.tools.includes(t.name));
  }

  getToolHandlers() {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(TOOL_HANDLERS)) {
      if (this.config.tools.includes(k)) result[k] = v;
    }
    return result;
  }
}

export async function runSubAgent(
  agent: any,
  sessionId: string | undefined,
  role: string,
  task: string,
): Promise<string> {
  const runner = new SubAgentRunner(role);
  const messages = [{ role: "user", content: task }];
  if (agent.provider === "openai") return runOpenai(agent, sessionId, runner, messages);
  return runAnthropic(agent, sessionId, runner, messages);
}

async function dispatchSubTool(
  agent: any,
  sessionId: string | undefined,
  handlerName: string,
  handlers: Record<string, any>,
  args: Record<string, any>,
): Promise<string> {
  const handler = handlers[handlerName];
  if (!handler) return `Tool ${handlerName} not available for this role`;
  const { config } = await import("./config.js");
  const deps = TOOL_DEPS[handlerName] ?? [];
  const depMap: Record<string, () => any> = {
    exchange: () => agent.exchange,
    config: () => config,
    memory: () => agent.memory,
    sessionId: () => sessionId,
    soul: () => agent.soul?.profile,
    exchange_manager: () => agent.exchangeManager,
    agent: () => agent,
    skill_loader: () => agent.skillLoader,
    strategy_store: () => agent.strategyStore,
  };
  const resolved: Record<string, any> = {};
  for (const d of deps) resolved[d] = depMap[d]?.();
  return handler({ ...resolved, ...args });
}

async function runOpenai(agent: any, sessionId: string | undefined, runner: SubAgentRunner, messages: any[]): Promise<string> {
  const { config } = await import("./config.js");
  const { openaiSubAgentKwargs } = await import("./llm/provider.js");
  const toolDefs = runner.getToolDefinitions();
  const handlers = runner.getToolHandlers();
  const tools = toolDefs.length
    ? toolDefs.map((t: any) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))
    : undefined;

  const subKw = openaiSubAgentKwargs(config);
  for (let turn = 0; turn < runner.maxTurns; turn++) {
    const response = await agent.client.chat.completions.create({
      messages: [{ role: "system", content: runner.systemPrompt }, ...messages],
      tools,
      ...subKw,
    });
    const msg = response.choices[0].message;
    const finish = response.choices[0].finish_reason;
    const usage = response.usage;
    process.stderr.write(
      `[sub-agent:${runner.role} turn ${turn}] finish=${finish} tools=${(msg.tool_calls ?? []).length} content_len=${(msg.content ?? "").length} usage=${JSON.stringify(usage)}\n`,
    );

    if (!msg.tool_calls?.length) return msg.content ?? "(no response)";

    messages.push({
      role: "assistant",
      content: msg.content,
      tool_calls: msg.tool_calls.map((tc: any) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });

    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments);
      const output = await dispatchSubTool(agent, sessionId, tc.function.name, handlers, args);
      messages.push({ role: "tool", tool_call_id: tc.id, content: output });
    }
  }
  return "(sub-agent reached max turns)";
}

async function runAnthropic(agent: any, sessionId: string | undefined, runner: SubAgentRunner, messages: any[]): Promise<string> {
  const { config } = await import("./config.js");
  const { anthropicSubAgentKwargs } = await import("./llm/provider.js");
  const toolDefs = runner.getToolDefinitions();
  const handlers = runner.getToolHandlers();

  const subKw = anthropicSubAgentKwargs(config);
  for (let turn = 0; turn < runner.maxTurns; turn++) {
    const response = await agent.client.messages.create({
      system: runner.systemPrompt,
      messages,
      tools: toolDefs.length ? toolDefs : [],
      ...subKw,
    });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return response.content
        .filter((b: any) => b.text)
        .map((b: any) => b.text)
        .join("\n");
    }

    const results: any[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const output = await dispatchSubTool(agent, sessionId, block.name, handlers, block.input);
        results.push({ type: "tool_result", tool_use_id: block.id, content: output });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return "(sub-agent reached max turns)";
}
