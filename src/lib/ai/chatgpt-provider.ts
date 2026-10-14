import "server-only";
import { chatgptAccess, assertLocalChatgpt } from "@/lib/integrations/chatgpt-local";
import { ProviderError, type AIProvider, type GenerateRequest, type GenerateResponse, type Usage } from "@/lib/ai/types";

export function chatgptRequest(req: GenerateRequest) {
  const input = req.messages.flatMap<Record<string, unknown>>(m => {
    if (m.role === "system") return [];
    if (m.role === "assistant" && m.providerItems?.length) return m.providerItems;
    if (m.role === "tool") return [{ type: "function_call_output", call_id: m.toolCallId, namespace: "machinarc", name: m.toolName, output: m.content }];
    if (m.role === "assistant") return [...(m.content ? [{ role: "assistant", content: m.content }] : []), ...(m.toolCalls ?? []).map(c => ({ type: "function_call", call_id: c.id, namespace: "machinarc", name: c.name, arguments: JSON.stringify(c.args) }))];
    return [{ role: "user", content: m.content }];
  });
  return { model: req.model, instructions: req.messages.filter(m => m.role === "system").map(m => m.content).join("\n"), input, store: false, stream: true, include: ["reasoning.encrypted_content"],
    ...(req.tools?.length ? { tools: [{ type: "namespace", name: "machinarc", description: "Permission-checked MachinArc tools", tools: req.tools.map(t => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })) }] } : {}),
    ...(req.responseSchema && !req.tools?.length ? { text: { format: { type: "json_schema", name: req.responseSchema.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), schema: req.responseSchema.schema, strict: false } } } : {}) };
}
type Completed = { status: string; model?: string; output?: (Record<string, unknown> & { type: string; name?: string; call_id?: string; arguments?: string; content?: { type: string; text?: string }[] })[]; usage?: unknown };
export async function completedChatgptResponse(response: Response): Promise<Completed> {
  if (!response.body) throw new ProviderError("unavailable", "ChatGPT returned no response stream.");
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = ""; let result: Completed | undefined; let bytes = 0;
  const items = new Map<number, NonNullable<Completed["output"]>[number]>();
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length; if (bytes > 8_000_000) throw new ProviderError("bad_request", "ChatGPT response exceeded the local size limit.");
      pending += decoder.decode(chunk.value, { stream: true });
      // SSE frames can cross network chunks. CRLF and LF delimiters are both supported.
      let match;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data) as { type: string; output_index?: number; item?: NonNullable<Completed["output"]>[number]; response?: Completed & { error?: { code?: string } }; error?: { code?: string } };
        if (event.type === "response.output_item.done" && event.item && Number.isInteger(event.output_index)) items.set(event.output_index!, event.item);
        if (event.type === "response.failed" || event.type === "error") {
          const code = event.response?.error?.code ?? event.error?.code;
          throw new ProviderError(code?.startsWith("subscription_sharing_usage") ? "quota" : "unavailable", code?.startsWith("subscription_sharing_usage") ? "ChatGPT plan usage is unavailable or its limit was reached. Review ChatGPT Settings → Usage." : "ChatGPT could not complete the response.");
        }
        if (event.type === "response.incomplete") throw new ProviderError("bad_request", "ChatGPT returned an incomplete response; no tools were executed.");
        if (event.type === "response.completed") result = event.response;
      }
    }
    if (!result || result.status !== "completed") throw new ProviderError("unavailable", "ChatGPT stream ended without a completed response; no tools were executed.");
    // ChatGPT plan streams can omit output from the terminal snapshot; completed item events carry it.
    return { ...result, output: result.output?.length ? result.output : [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item) };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class ChatgptProvider implements AIProvider {
  readonly name = "chatgpt" as const;
  constructor(private workspaceId: string) {}
  supportsToolCalling() { return true; }
  calculateEstimatedCost() { return null; }
  normalizeUsage(raw: unknown): Usage { const u = (raw ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }; return { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cachedTokens: u.input_tokens_details?.cached_tokens ?? 0 }; }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    assertLocalChatgpt(); const access = await chatgptAccess(this.workspaceId);
    if (!access.models.some(m => m.id === req.model)) throw new ProviderError("invalid_model", "Select a model from the connected ChatGPT account's catalog.");
    const start = Date.now(), timeout = AbortSignal.timeout(req.timeoutMs ?? 90_000), signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    try {
      const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" }, body: JSON.stringify(chatgptRequest(req)), signal });
      if (!response.ok) throw new ProviderError(response.status === 401 || response.status === 403 ? "auth" : response.status === 429 ? "rate_limit" : response.status >= 500 ? "unavailable" : "bad_request", `ChatGPT rejected the request (${response.status}). Reconnect or review plan usage in Integrations.`, response.status);
      const result = await completedChatgptResponse(response);
      const toolCalls = (result.output ?? []).filter(item => item.type === "function_call").map(item => {
        const args: unknown = JSON.parse(item.arguments ?? "{}");
        if (!item.name || !item.call_id || !args || typeof args !== "object" || Array.isArray(args)) throw new ProviderError("bad_request", "ChatGPT returned an invalid tool call.");
        return { id: item.call_id, name: item.name.replace(/^machinarc\./, ""), args: args as Record<string, unknown> };
      });
      if (toolCalls.length > 8) throw new ProviderError("bad_request", "ChatGPT exceeded the local tool batch limit; no tools were executed.");
      const providerItems = (result.output ?? []).flatMap<Record<string, unknown>>(item => item.type === "reasoning"
        ? typeof item.encrypted_content === "string" ? [{ type: "reasoning", ...(item.id ? { id: item.id } : {}), encrypted_content: item.encrypted_content, summary: [] }] : []
        : item.type === "message" || item.type === "function_call" ? [item] : []);
      return { content: (result.output ?? []).flatMap(item => item.content ?? []).filter(c => c.type === "output_text").map(c => c.text ?? "").join(""), toolCalls, providerItems, usage: this.normalizeUsage(result.usage), finishReason: toolCalls.length ? "tool_calls" : "stop", providerMetadata: { provider: "chatgpt", model: result.model ?? req.model, latencyMs: Date.now() - start, requestId: response.headers.get("x-request-id") ?? undefined } };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (req.signal?.aborted) throw new ProviderError("cancelled", "Request cancelled by operator.");
      if (signal.aborted) throw new ProviderError("timeout", "ChatGPT did not complete the request in time.");
      throw new ProviderError("unavailable", "ChatGPT could not complete the request.");
    }
  }
}
