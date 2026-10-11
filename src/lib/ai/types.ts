import type { JSONSchema } from "@/lib/tools/schema";

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; toolName: string };
export type ToolSpec = { name: string; description: string; parameters: JSONSchema };
export type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number };
export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "error";

export type GenerateRequest = {
  model: string; messages: ChatMessage[]; tools?: ToolSpec[]; temperature?: number; reasoningEffort?: "minimal" | "low" | "medium" | "high";
  maxOutputTokens?: number; responseSchema?: { name: string; schema: JSONSchema }; signal?: AbortSignal; timeoutMs?: number;
};
export type GenerateResponse = {
  content: string; toolCalls: ToolCall[]; usage: Usage; finishReason: FinishReason;
  providerMetadata: { provider: string; model: string; latencyMs: number; requestId?: string };
};

export type ProviderErrorKind = "auth" | "quota" | "rate_limit" | "context_length" | "unavailable" | "invalid_model" | "bad_request" | "timeout" | "cancelled";
export class ProviderError extends Error {
  constructor(public kind: ProviderErrorKind, message: string, public status?: number) { super(message); }
  get transient() { return this.kind === "rate_limit" || this.kind === "unavailable" || this.kind === "timeout"; }
}

export interface AIProvider {
  readonly name: "openai" | "anthropic" | "mock";
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  supportsToolCalling(model: string): boolean;
  calculateEstimatedCost(model: string, usage: Usage): number | null;
  normalizeUsage(raw: unknown): Usage;
}
