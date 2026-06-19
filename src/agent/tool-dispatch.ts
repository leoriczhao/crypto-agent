import { TOOL_DEPS, TOOL_HANDLERS } from "../tools/registry.js";
import type { config as appConfig } from "../config.js";
import type { CryptoAgent } from "../agent.js";
import type { ExchangeManager } from "../exchange/manager.js";
import type { Memory } from "../memory.js";
import type { SkillLoader } from "../skill-loader.js";
import type { StrategyManager } from "../strategy/manager.js";
import type { Broker } from "../broker/types.js";

export interface AgentToolDeps {
  getExchange: () => unknown;
  getConfig: () => typeof appConfig;
  getMemory: () => Memory | null;
  getSessionId: () => string;
  getSoul: () => unknown;
  getExchangeManager: () => ExchangeManager;
  getBroker: () => Broker | null;
  getAgent: () => CryptoAgent;
  getSkillLoader: () => SkillLoader;
  getStrategyStore: () => StrategyManager | null;
}

export async function dispatchAgentTool(
  name: string,
  inputs: Record<string, unknown>,
  deps: AgentToolDeps,
): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return `Unknown tool: ${name}`;

  const depMap: Record<string, () => unknown> = {
    exchange: deps.getExchange,
    config: deps.getConfig,
    memory: deps.getMemory,
    sessionId: deps.getSessionId,
    soul: deps.getSoul,
    exchange_manager: deps.getExchangeManager,
    broker: deps.getBroker,
    agent: deps.getAgent,
    skill_loader: deps.getSkillLoader,
    strategy_store: deps.getStrategyStore,
  };

  const resolved: Record<string, unknown> = {};
  for (const dep of TOOL_DEPS[name] ?? []) resolved[dep] = depMap[dep]?.();
  return handler({ ...resolved, ...inputs });
}
