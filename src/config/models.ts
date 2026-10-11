// Central model registry. The only place model IDs, capabilities and pricing live.
// Pricing is USD per 1M tokens as configured by MachinArc; null = unknown (usage shown without cost).

export type ProviderId = "openai" | "anthropic" | "mock";
export type Capability = "tools" | "structured" | "vision" | "long_context" | "reasoning";
export type ModelDef = {
  provider: ProviderId; id: string; name: string; capabilities: Capability[]; contextTokens: number;
  speed: "fast" | "balanced" | "deep"; inputPer1M: number | null; outputPer1M: number | null; cachedPer1M?: number | null;
  enabled: boolean; reasoningEffort?: boolean; noTemperature?: boolean;
};

export const PROVIDERS: Record<ProviderId, { label: string; envKey?: string; docs?: string }> = {
  openai: { label: "OpenAI", envKey: "OPENAI_API_KEY", docs: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Anthropic", envKey: "ANTHROPIC_API_KEY", docs: "https://console.anthropic.com/settings/keys" },
  mock: { label: "Mock Runtime" },
};

export const MODELS: ModelDef[] = [
  { provider: "openai", id: "gpt-5", name: "GPT-5", capabilities: ["tools", "structured", "vision", "long_context", "reasoning"], contextTokens: 400_000, speed: "deep", inputPer1M: 1.25, outputPer1M: 10, cachedPer1M: 0.125, enabled: true, reasoningEffort: true, noTemperature: true },
  { provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini", capabilities: ["tools", "structured", "vision", "long_context", "reasoning"], contextTokens: 400_000, speed: "balanced", inputPer1M: 0.25, outputPer1M: 2, cachedPer1M: 0.025, enabled: true, reasoningEffort: true, noTemperature: true },
  { provider: "openai", id: "gpt-4.1", name: "GPT-4.1", capabilities: ["tools", "structured", "vision", "long_context"], contextTokens: 1_000_000, speed: "balanced", inputPer1M: 2, outputPer1M: 8, cachedPer1M: 0.5, enabled: true },
  { provider: "openai", id: "gpt-4.1-mini", name: "GPT-4.1 mini", capabilities: ["tools", "structured", "vision", "long_context"], contextTokens: 1_000_000, speed: "fast", inputPer1M: 0.4, outputPer1M: 1.6, cachedPer1M: 0.1, enabled: true },
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", capabilities: ["tools", "structured", "vision", "long_context", "reasoning"], contextTokens: 200_000, speed: "balanced", inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3, enabled: true },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", capabilities: ["tools", "structured", "vision", "long_context"], contextTokens: 200_000, speed: "fast", inputPer1M: 1, outputPer1M: 5, cachedPer1M: 0.1, enabled: true },
  { provider: "anthropic", id: "claude-opus-4-1", name: "Claude Opus 4.1", capabilities: ["tools", "structured", "vision", "long_context", "reasoning"], contextTokens: 200_000, speed: "deep", inputPer1M: 15, outputPer1M: 75, cachedPer1M: 1.5, enabled: true },
  { provider: "mock", id: "mock-runtime", name: "Mock Runtime", capabilities: ["tools", "structured"], contextTokens: 32_000, speed: "fast", inputPer1M: 0.1, outputPer1M: 0.4, enabled: true },
];

export const CAPABILITY_LABEL: Record<Capability, string> = { tools: "TOOL USE", structured: "STRUCTURED OUTPUT", vision: "VISION", long_context: "LONG CONTEXT", reasoning: "REASONING" };

export function getModel(provider: string, id: string): ModelDef | undefined {
  return MODELS.find((m) => m.provider === provider && m.id === id);
}
export function modelsFor(provider: string) { return MODELS.filter((m) => m.provider === provider && m.enabled); }

/** Returns cost in USD, or null when pricing for this model is not configured. */
export function priceUsage(provider: string, model: string, u: { inputTokens: number; outputTokens: number; cachedTokens?: number }): number | null {
  const m = getModel(provider, model);
  if (!m || m.inputPer1M === null || m.outputPer1M === null) return null;
  const cached = u.cachedTokens ?? 0;
  const fresh = Math.max(0, u.inputTokens - cached);
  const cost = (fresh * m.inputPer1M + cached * (m.cachedPer1M ?? m.inputPer1M) + u.outputTokens * m.outputPer1M) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
