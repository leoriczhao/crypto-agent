import { registerTool } from "./registry.js";

registerTool(
  "delegate",
  "Delegate a task to a specialized sub-agent.\nRoles:\n- researcher: market analysis, news, on-chain data, technical indicators (read-only)\n- trader: executes trades, uses strategy and portfolio tools\n- risk_officer: evaluates portfolio risk, concentration, drawdowns (advisory)\n\nThe sub-agent will run autonomously with its specialized tools and return a report.",
  {
    type: "object",
    properties: {
      role: { type: "string", enum: ["researcher", "trader", "risk_officer"] },
      task: { type: "string", description: "Detailed description of what the sub-agent should do" },
    },
    required: ["role", "task"],
  },
  async ({ agent, role, task }) => {
    try {
      const { SubAgentRunner } = await import("../sub-agents.js");
      const runner = new SubAgentRunner(role);
      const result = await runSubAgent(agent, runner, task);
      return `[${role.toUpperCase()}] ${result}`;
    } catch (e: any) {
      return `Delegation error: ${e.message ?? e}`;
    }
  },
);

async function runSubAgent(agent: any, runner: any, task: string): Promise<string> {
  const subMessages = [{ role: "user", content: task }];
  if (agent.provider === "openai") return runOpenai(agent, runner, subMessages);
  return runAnthropic(agent, runner, subMessages);
}

async function dispatchSubTool(agent: any, handlerName: string, handlers: Record<string, any>, args: Record<string, any>): Promise<string> {
  const handler = handlers[handlerName];
  if (!handler) return `Tool ${handlerName} not available for this role`;
  const { config } = await import("../config.js");
  if (["buy", "sell", "assess_risk"].includes(handlerName)) {
    return handler({ exchange: agent.exchange, config, ...args });
  }
  return handler({ exchange: agent.exchange, ...args });
}

async function runOpenai(agent: any, runner: any, messages: any[]): Promise<string> {
  const { config } = await import("../config.js");
  const { openaiSubAgentKwargs } = await import("../llm/provider.js");
  const toolDefs = runner.getToolDefinitions();
  const handlers = runner.getToolHandlers();
  const tools = toolDefs.length
    ? toolDefs.map((t: any) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))
    : undefined;

  const subKw = openaiSubAgentKwargs(config);
  for (let turn = 0; turn < 5; turn++) {
    const response = await agent.client.chat.completions.create({
      messages: [{ role: "system", content: runner.systemPrompt }, ...messages],
      tools,
      ...subKw,
    });
    const msg = response.choices[0].message;

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
      const output = await dispatchSubTool(agent, tc.function.name, handlers, args);
      messages.push({ role: "tool", tool_call_id: tc.id, content: output });
    }
  }
  return "(sub-agent reached max turns)";
}

async function runAnthropic(agent: any, runner: any, messages: any[]): Promise<string> {
  const { config } = await import("../config.js");
  const { anthropicSubAgentKwargs } = await import("../llm/provider.js");
  const toolDefs = runner.getToolDefinitions();
  const handlers = runner.getToolHandlers();

  const subKw = anthropicSubAgentKwargs(config);
  for (let turn = 0; turn < 5; turn++) {
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
        const output = await dispatchSubTool(agent, block.name, handlers, block.input);
        results.push({ type: "tool_result", tool_use_id: block.id, content: output });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return "(sub-agent reached max turns)";
}
