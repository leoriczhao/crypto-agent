import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { config as appConfig } from "../config.js";
import { dispatchAgentTool, type AgentToolDeps } from "./tool-dispatch.js";
import {
  extractToolRequests,
  hasToolCalls,
  makeToolResultMessages,
  runAnthropicStep,
  runOpenaiStep,
  type AgentAssistantMessage,
  type AgentMessage,
  type ProviderStepCallbacks,
} from "./provider-step.js";

export const AgentState = Annotation.Root({
  messages: Annotation<AgentMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  finalText: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
});

export interface AgentGraphRunOptions {
  provider: string;
  client: any;
  messages: AgentMessage[];
  systemPrompt: string;
  sessionId: string;
  callbacks?: ProviderStepCallbacks;
  toolDeps: AgentToolDeps;
}

export interface AgentGraphRunResult {
  messages: AgentMessage[];
  finalText: string;
}

export function routeAfterModel(state: typeof AgentState.State): "tools" | typeof END {
  const last = state.messages[state.messages.length - 1] as AgentAssistantMessage | undefined;
  return last && hasToolCalls(last) ? "tools" : END;
}

export function createAgentGraphRuntime() {
  return {
    async run(opts: AgentGraphRunOptions): Promise<AgentGraphRunResult> {
      const callModel = async (state: typeof AgentState.State) => {
        const stepOpts = {
          client: opts.client,
          config: appConfig,
          messages: state.messages,
          systemPrompt: opts.systemPrompt,
          callbacks: opts.callbacks,
        };
        const result = opts.provider === "openai"
          ? await runOpenaiStep(stepOpts)
          : await runAnthropicStep(stepOpts);
        return { messages: [result.message], finalText: result.text };
      };

      const executeTools = async (state: typeof AgentState.State) => {
        const last = state.messages[state.messages.length - 1] as AgentAssistantMessage | undefined;
        const requests = extractToolRequests(last);
        const outputs = [];
        for (const req of requests) {
          opts.callbacks?.signal?.throwIfAborted?.();
          opts.callbacks?.onToolUse?.(req.name);
          const content = await dispatchAgentTool(req.name, req.args, opts.toolDeps);
          outputs.push({ id: req.id, content });
        }
        return { messages: makeToolResultMessages(opts.provider, outputs) };
      };

      const graph = new StateGraph(AgentState)
        .addNode("call_model", callModel)
        .addNode("tools", executeTools)
        .addEdge(START, "call_model")
        .addConditionalEdges("call_model", routeAfterModel)
        .addEdge("tools", "call_model")
        .compile();

      const finalState = await graph.invoke({
        messages: opts.messages,
        finalText: "",
      });
      return {
        messages: finalState.messages,
        finalText: finalState.finalText,
      };
    },
  };
}
