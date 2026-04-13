import type { Config } from "../config.js";

export function openaiChatCompletionKwargs(cfg: Config, opts?: { maxTokens?: number }): Record<string, any> {
  const mt = opts?.maxTokens ?? cfg.llmMaxTokens;
  const out: Record<string, any> = { model: cfg.modelId, max_tokens: mt };
  if (cfg.llmTemperature !== null) out.temperature = cfg.llmTemperature;
  if (cfg.llmTopP !== null) out.top_p = cfg.llmTopP;
  if (cfg.llmFrequencyPenalty !== null) out.frequency_penalty = cfg.llmFrequencyPenalty;
  if (cfg.llmPresencePenalty !== null) out.presence_penalty = cfg.llmPresencePenalty;
  if (cfg.llmSeed !== null) out.seed = cfg.llmSeed;
  if (cfg.llmStop) out.stop = cfg.llmStop;
  if (Object.keys(cfg.llmExtraBody).length) out.extra_body = { ...cfg.llmExtraBody };
  return out;
}

export function openaiSubAgentKwargs(cfg: Config): Record<string, any> {
  return openaiChatCompletionKwargs(cfg, { maxTokens: cfg.subAgentMaxTokens });
}

export function anthropicMessageKwargs(cfg: Config, opts?: { maxTokens?: number }): Record<string, any> {
  const mt = opts?.maxTokens ?? cfg.llmMaxTokens;
  const out: Record<string, any> = { model: cfg.modelId, max_tokens: mt };
  if (cfg.llmTemperature !== null) out.temperature = cfg.llmTemperature;
  if (cfg.llmTopP !== null) out.top_p = cfg.llmTopP;
  if (cfg.anthropicTopK !== null) out.top_k = cfg.anthropicTopK;
  return out;
}

export function anthropicSubAgentKwargs(cfg: Config): Record<string, any> {
  return anthropicMessageKwargs(cfg, { maxTokens: cfg.subAgentMaxTokens });
}

export function compactSummaryOpenaiKwargs(cfg: Config): Record<string, any> {
  const model = cfg.compactSummaryModelId || cfg.modelId;
  const out: Record<string, any> = { model, max_tokens: cfg.compactSummaryMaxTokens };
  if (cfg.llmTemperature !== null) out.temperature = cfg.llmTemperature;
  if (cfg.llmTopP !== null) out.top_p = cfg.llmTopP;
  if (Object.keys(cfg.llmExtraBody).length) out.extra_body = { ...cfg.llmExtraBody };
  return out;
}

export function compactSummaryAnthropicKwargs(cfg: Config): Record<string, any> {
  const model = cfg.compactSummaryModelId || cfg.modelId;
  const out: Record<string, any> = { model, max_tokens: cfg.compactSummaryMaxTokens };
  if (cfg.llmTemperature !== null) out.temperature = cfg.llmTemperature;
  if (cfg.llmTopP !== null) out.top_p = cfg.llmTopP;
  if (cfg.anthropicTopK !== null) out.top_k = cfg.anthropicTopK;
  return out;
}
