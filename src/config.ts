import "dotenv/config";

function envBool(key: string, defaultVal: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || !v.trim()) return defaultVal;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function envOptFloat(key: string): number | null {
  const v = process.env[key];
  if (v === undefined || !v.trim()) return null;
  return parseFloat(v);
}

function envOptInt(key: string): number | null {
  const v = process.env[key];
  if (v === undefined || !v.trim()) return null;
  return parseInt(v, 10);
}

function envJsonObject(key: string, defaultVal: Record<string, any>): Record<string, any> {
  const raw = process.env[key];
  if (!raw || !raw.trim()) return defaultVal;
  try {
    const data = JSON.parse(raw);
    return typeof data === "object" && data !== null && !Array.isArray(data) ? data : defaultVal;
  } catch {
    return defaultVal;
  }
}

function envStopSequences(): string[] | null {
  const raw = process.env["LLM_STOP"];
  if (!raw || !raw.trim()) return null;
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

if (process.env.ANTHROPIC_BASE_URL) {
  delete process.env.ANTHROPIC_AUTH_TOKEN;
}

export const config = {
  llmProvider: process.env.LLM_PROVIDER ?? "openai",
  apiKey: process.env.API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
  apiBaseUrl: process.env.API_BASE_URL ?? process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "",
  modelId: process.env.MODEL_ID ?? "gpt-5.4",
  llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS ?? "4096", 10),
  llmContextWindow: parseInt(process.env.LLM_CONTEXT_WINDOW ?? "500000", 10),
  llmTemperature: envOptFloat("LLM_TEMPERATURE"),
  llmTopP: envOptFloat("LLM_TOP_P"),
  llmFrequencyPenalty: envOptFloat("LLM_FREQUENCY_PENALTY"),
  llmPresencePenalty: envOptFloat("LLM_PRESENCE_PENALTY"),
  llmSeed: envOptInt("LLM_SEED"),
  llmStop: envStopSequences(),
  llmExtraBody: envJsonObject("LLM_EXTRA_BODY_JSON", {}),
  anthropicTopK: envOptInt("ANTHROPIC_TOP_K"),

  subAgentMaxTokens: parseInt(process.env.SUB_AGENT_MAX_TOKENS ?? "2048", 10),
  compactSummaryMaxTokens: parseInt(process.env.COMPACT_SUMMARY_MAX_TOKENS ?? "1024", 10),
  compactSummaryModelId: (process.env.COMPACT_SUMMARY_MODEL_ID ?? "").trim(),

  contextCharsPerToken: Math.max(1, parseInt(process.env.CONTEXT_CHARS_PER_TOKEN ?? "4", 10)),
  microCompactEnabled: envBool("MICRO_COMPACT_ENABLED", true),
  microCompactKeepRecent: Math.max(0, parseInt(process.env.MICRO_COMPACT_KEEP_RECENT ?? "3", 10)),
  microCompactMinContentLen: Math.max(1, parseInt(process.env.MICRO_COMPACT_MIN_CONTENT_LEN ?? "200", 10)),
  autoCompactEnabled: envBool("AUTO_COMPACT_ENABLED", false),
  autoCompactTokenThreshold: parseInt(
    process.env.AUTO_COMPACT_TOKEN_THRESHOLD ?? process.env.LLM_CONTEXT_WINDOW ?? "500000",
    10,
  ),
  autoCompactTranscriptDir: process.env.AUTO_COMPACT_TRANSCRIPT_DIR ?? ".transcripts",

  defaultExchange: process.env.DEFAULT_EXCHANGE ?? "gateio",
  paperTrading: (process.env.PAPER_TRADING ?? "true").toLowerCase() === "true",
  initialBalance: { USDT: parseFloat(process.env.INITIAL_BALANCE_USDT ?? "10000") } as Record<string, number>,
  maxOrderSizeUsdt: parseFloat(process.env.MAX_ORDER_SIZE_USDT ?? "1000"),
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL ?? "60", 10),
  memoryDbPath: process.env.MEMORY_DB_PATH ?? "crypto_agent.db",
  notifyTelegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  notifyTelegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  exchangeApiKey: process.env.EXCHANGE_API_KEY ?? "",
  exchangeSecret: process.env.EXCHANGE_SECRET ?? "",
  exchangePassword: process.env.EXCHANGE_PASSWORD ?? "",
  extraExchanges: JSON.parse(process.env.EXTRA_EXCHANGES ?? "{}") as Record<string, Record<string, string>>,
  tradingSoul: process.env.TRADING_SOUL ?? "balanced",
};

export type Config = typeof config;
