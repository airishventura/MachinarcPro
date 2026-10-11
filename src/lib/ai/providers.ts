import "server-only";
import { getModel, priceUsage } from "@/config/models";
import { AIProvider, ChatMessage, GenerateRequest, GenerateResponse, ProviderError, ToolCall, Usage } from "@/lib/ai/types";

export { ProviderError } from "@/lib/ai/types";
export type { AIProvider } from "@/lib/ai/types";

function combineSignals(req: GenerateRequest) {
  const t = AbortSignal.timeout(req.timeoutMs ?? 90_000);
  return req.signal ? AbortSignal.any([req.signal, t]) : t;
}
function wrapFetchError(e: unknown, req: GenerateRequest): never {
  if (e instanceof ProviderError) throw e;
  if (req.signal?.aborted) throw new ProviderError("cancelled", "Request cancelled by operator.");
  const name = (e as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError") throw new ProviderError("timeout", "The AI provider did not respond in time.");
  throw new ProviderError("unavailable", "Could not reach the AI provider.");
}
const safeParse = (s: string): Record<string, unknown> => { try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : { value: v }; } catch { return { _raw: String(s).slice(0, 2000) }; } };

// ---------------- OpenAI ----------------
export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  constructor(private key: string, private baseUrl = "https://api.openai.com/v1") {}
  supportsToolCalling(model: string) { return getModel("openai", model)?.capabilities.includes("tools") ?? true; }
  calculateEstimatedCost(model: string, u: Usage) { return priceUsage("openai", model, u); }
  normalizeUsage(raw: unknown): Usage {
    const u = (raw ?? {}) as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    return { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0 };
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const def = getModel("openai", req.model);
    const messages = req.messages.map((m) => {
      if (m.role === "assistant") return { role: "assistant", content: m.content || null, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) };
      if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      return { role: m.role, content: m.content };
    });
    const body: Record<string, unknown> = { model: req.model, messages, max_completion_tokens: req.maxOutputTokens ?? 4096 };
    if (req.tools?.length) { body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })); body.tool_choice = "auto"; }
    if (!def?.noTemperature && req.temperature !== undefined) body.temperature = req.temperature;
    if (def?.reasoningEffort && req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;
    if (req.responseSchema && !req.tools?.length) body.response_format = { type: "json_schema", json_schema: { name: req.responseSchema.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), schema: req.responseSchema.schema, strict: false } };
    const t0 = Date.now();
    let r: Response;
    try { r = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.key}` }, body: JSON.stringify(body), signal: combineSignals(req) }); }
    catch (e) { wrapFetchError(e, req); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({})) as { error?: { code?: string; type?: string; message?: string } };
      const code = j.error?.code ?? j.error?.type ?? "";
      if (r.status === 401 || r.status === 403) throw new ProviderError("auth", "OpenAI rejected the API key.", r.status);
      if (code === "insufficient_quota") throw new ProviderError("quota", "OpenAI account has insufficient quota.", r.status);
      if (r.status === 429) throw new ProviderError("rate_limit", "OpenAI rate limit reached.", r.status);
      if (code === "context_length_exceeded") throw new ProviderError("context_length", "The request exceeded the model context window.", r.status);
      if (r.status === 404 || code === "model_not_found") throw new ProviderError("invalid_model", `Model ${req.model} is not available for this account.`, r.status);
      if (r.status >= 500) throw new ProviderError("unavailable", "OpenAI is temporarily unavailable.", r.status);
      throw new ProviderError("bad_request", `OpenAI rejected the request (${code || r.status}).`, r.status);
    }
    const j = await r.json();
    const msg = j.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).filter((c: { type?: string }) => c.type === "function").map((c: { id: string; function: { name: string; arguments: string } }) => ({ id: c.id, name: c.function.name, args: safeParse(c.function.arguments) }));
    const fr = j.choices?.[0]?.finish_reason;
    return { content: msg.content ?? "", toolCalls, usage: this.normalizeUsage(j.usage), finishReason: toolCalls.length ? "tool_calls" : fr === "length" ? "length" : fr === "content_filter" ? "content_filter" : "stop", providerMetadata: { provider: "openai", model: j.model ?? req.model, latencyMs: Date.now() - t0, requestId: r.headers.get("x-request-id") ?? undefined } };
  }
}

// ---------------- Anthropic ----------------
type ABlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  constructor(private key: string) {}
  supportsToolCalling(model: string) { return getModel("anthropic", model)?.capabilities.includes("tools") ?? true; }
  calculateEstimatedCost(model: string, u: Usage) { return priceUsage("anthropic", model, u); }
  normalizeUsage(raw: unknown): Usage {
    const u = (raw ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    return { inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0 };
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n")
      + (req.responseSchema ? `\n\nRESPONSE FORMAT: Respond with ONLY a JSON value matching this JSON Schema, no prose:\n${JSON.stringify(req.responseSchema.schema)}` : "");
    const out: { role: "user" | "assistant"; content: ABlock[] }[] = [];
    const push = (role: "user" | "assistant", blocks: ABlock[]) => { const last = out[out.length - 1]; if (last && last.role === role) last.content.push(...blocks); else out.push({ role, content: blocks }); };
    for (const m of req.messages as ChatMessage[]) {
      if (m.role === "system") continue;
      if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
      else if (m.role === "assistant") push("assistant", [...(m.content ? [{ type: "text" as const, text: m.content }] : []), ...(m.toolCalls ?? []).map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.args }))]);
      else push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
    }
    const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxOutputTokens ?? 4096, system, messages: out };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const t0 = Date.now();
    let r: Response;
    try { r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": this.key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body), signal: combineSignals(req) }); }
    catch (e) { wrapFetchError(e, req); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({})) as { error?: { type?: string; message?: string } };
      const type = j.error?.type ?? "", msg = j.error?.message ?? "";
      if (r.status === 401 || r.status === 403) throw new ProviderError("auth", "Anthropic rejected the API key.", r.status);
      if (r.status === 429) throw new ProviderError("rate_limit", "Anthropic rate limit reached.", r.status);
      if (r.status === 529 || r.status >= 500) throw new ProviderError("unavailable", "Anthropic is temporarily unavailable.", r.status);
      if (/prompt is too long|context/i.test(msg)) throw new ProviderError("context_length", "The request exceeded the model context window.", r.status);
      if (r.status === 404 || type === "not_found_error") throw new ProviderError("invalid_model", `Model ${req.model} is not available for this account.`, r.status);
      if (/credit balance/i.test(msg)) throw new ProviderError("quota", "Anthropic account has insufficient credit.", r.status);
      throw new ProviderError("bad_request", `Anthropic rejected the request (${type || r.status}).`, r.status);
    }
    const j = await r.json();
    const blocks = (j.content ?? []) as ABlock[];
    const toolCalls: ToolCall[] = blocks.filter((b): b is Extract<ABlock, { type: "tool_use" }> => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown> }));
    const content = blocks.filter((b): b is Extract<ABlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("");
    return { content, toolCalls, usage: this.normalizeUsage(j.usage), finishReason: toolCalls.length ? "tool_calls" : j.stop_reason === "max_tokens" ? "length" : "stop", providerMetadata: { provider: "anthropic", model: j.model ?? req.model, latencyMs: Date.now() - t0, requestId: r.headers.get("request-id") ?? undefined } };
  }
}

// ---------------- Mock Runtime ----------------
const NAMES = ["Lattice Compute", "Vectorline", "Halcyon Inference", "Basalt Systems", "Northstar GPU", "Quill Labs", "Meridian Data", "Kelvin Edge", "Parallax AI"];
const WHY = ["developer adoption tripled in two quarters", "open-source repo crossed 20k stars", "signed three hyperscaler partnerships", "inference cost 40% below incumbents", "hiring velocity up 3× since seed", "usage-based revenue compounding monthly"];

/**
 * Deterministic scripted provider. Issues real tool calls (executed in SIMULATED mode by the runtime)
 * so permissions, approvals, limits and telemetry behave exactly as with a real model.
 * Test hooks in the task: [simulate-failure] [high-confidence] [low-confidence] [loop] [http-post] [call:NAME] [remember] [calc]
 */
export class MockProvider implements AIProvider {
  readonly name = "mock" as const;
  supportsToolCalling() { return true; }
  calculateEstimatedCost(model: string, u: Usage) { return priceUsage("mock", "mock-runtime", u); }
  normalizeUsage(raw: unknown): Usage { return raw as Usage; }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const t0 = Date.now();
    await new Promise((r, rej) => { const t = setTimeout(r, 250 + Math.random() * 350); req.signal?.addEventListener("abort", () => { clearTimeout(t); rej(new ProviderError("cancelled", "Request cancelled by operator.")); }); });
    const task = [...req.messages].reverse().find((m) => m.role === "user" && m.content.includes("<task>"))?.content ?? req.messages.find((m) => m.role === "user")?.content ?? "";
    const taskText = task.match(/<task>([\s\S]*?)<\/task>/)?.[1]?.trim() ?? task;
    if (/\[simulate-failure\]/i.test(taskText)) throw new ProviderError("unavailable", "Simulated provider failure");
    const available = new Set((req.tools ?? []).map((t) => t.name));
    const called = req.messages.filter((m): m is Extract<ChatMessage, { role: "assistant" }> => m.role === "assistant").flatMap((m) => m.toolCalls ?? []);
    const did = (n: string) => called.some((c) => c.name === n);
    const lastResults = req.messages.filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool");
    const query = taskText.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "emerging technology";
    const usage = (out: number): Usage => ({ inputTokens: Math.round(req.messages.reduce((a, m) => a + m.content.length, 0) / 4) + 200, outputTokens: out, cachedTokens: 0 });
    const call = (name: string, args: Record<string, unknown>, plan: string): GenerateResponse => ({ content: plan, toolCalls: [{ id: `mock_${name}_${called.length + 1}`, name, args }], usage: usage(60 + Math.round(Math.random() * 40)), finishReason: "tool_calls", providerMetadata: { provider: "mock", model: "mock-runtime", latencyMs: Date.now() - t0 } });

    if (/\[loop\]/i.test(taskText) && available.has("web_search") && called.length < 12) return call("web_search", { query, max_results: 5 }, "Searching relevant sources.");
    if (available.has("web_search") && !did("web_search")) return call("web_search", { query, max_results: 5 }, "Searching relevant sources.");
    if (available.has("fetch_page") && !did("fetch_page") && did("web_search")) {
      const url = lastResults.map((r) => r.content.match(/"url"\s*:\s*"([^"]+)"/)?.[1]).find(Boolean);
      if (url) return call("fetch_page", { url }, "Fetching the most relevant source.");
    }
    if (/\[http-post\]/i.test(taskText) && available.has("http_request") && !did("http_request")) return call("http_request", { method: "POST", url: "https://httpbin.org/post", json: { leads: 12, source: "machinarc" } }, "Submitting qualified records to the configured endpoint.");
    const target = taskText.match(/\[call:([^\]]+)\]/i)?.[1];
    if (target && available.has("request_machine") && !did("request_machine")) return call("request_machine", { machine: target.trim(), task: `Analyze: ${query}` }, `Delegating analysis to ${target.trim()}.`);
    if (/\[calc\]/i.test(taskText) && available.has("calculator") && !did("calculator")) return call("calculator", { expression: "(12 * 4.5 + 3) / 2" }, "Computing aggregate score.");
    if (/\[remember\]/i.test(taskText) && available.has("remember") && !did("remember")) return call("remember", { content: `Operator is tracking: ${query}`, importance: 4, kind: "fact" }, "Recording a durable fact.");

    const conf = /\[high-confidence\]/i.test(taskText) ? 0.85 + Math.random() * 0.12 : /\[low-confidence\]/i.test(taskText) ? 0.48 + Math.random() * 0.22 : 0.6 + Math.random() * 0.37;
    const n = Math.min(7, Math.max(3, Number(query.match(/\b(\d{1,2})\b/)?.[1]) || 5));
    const pick = [...NAMES].sort(() => Math.random() - 0.5).slice(0, n);
    const hasSources = lastResults.some((r) => r.content.includes('"ref"'));
    if (req.responseSchema) {
      const props = (req.responseSchema.schema.properties ?? {}) as Record<string, { type?: string; items?: { properties?: Record<string, { type?: string }> } }>;
      const fill = (p: Record<string, { type?: string }>, i: number) => Object.fromEntries(Object.entries(p).map(([k, d]) => [k, d.type === "number" ? Number((k.includes("conf") ? conf : 10 + i).toFixed(2)) : d.type === "boolean" ? i % 2 === 0 : k.includes("url") || k.includes("website") ? `https://simulated.invalid/${i}` : `${pick[i % pick.length]} · ${k}`]));
      const obj: Record<string, unknown> = props.items?.items?.properties ? { items: pick.slice(0, 3).map((_, i) => fill(props.items!.items!.properties!, i)) } : fill(props as Record<string, { type?: string }>, 0);
      return { content: JSON.stringify(obj), toolCalls: [], usage: usage(220), finishReason: "stop", providerMetadata: { provider: "mock", model: "mock-runtime", latencyMs: Date.now() - t0 } };
    }
    const text = [
      `SUMMARY\nMock Runtime evaluated "${query}" and identified ${n} relevant results.\nCONFIDENCE: ${conf.toFixed(2)}`,
      `FINDINGS\n${pick.map((name, i) => `${i + 1}. ${name} — ${WHY[(i + name.length) % WHY.length]}.${hasSources && i === 0 ? " [S1]" : ""}`).join("\n")}`,
      `OPEN QUESTIONS\nWhich signals persist beyond a single news cycle?`,
      `NOTE\nGenerated by Mock Runtime with simulated tools. No real external sources were accessed.`,
    ].join("\n\n");
    return { content: text, toolCalls: [], usage: usage(420 + Math.round(Math.random() * 300)), finishReason: "stop", providerMetadata: { provider: "mock", model: "mock-runtime", latencyMs: Date.now() - t0 } };
  }
}
