import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "./tools/registry.js";

export const ROLES: Record<string, { system: string; tools: string[] }> = {
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
};

export class SubAgentRunner {
  role: string;
  private config: { system: string; tools: string[] };

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
