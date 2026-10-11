import "server-only";
import { NetError, assertPublicUrl, hostAllowed, htmlToText, safeFetch } from "@/lib/security/net";
import { rateLimit, LIMITS } from "@/lib/security/rate-limit";
import { redact } from "@/lib/security/redact";
import { calculate } from "@/lib/tools/calculator";
import { schemaFromFields } from "@/lib/tools/schema";
import { getIntegration, getSecret } from "@/lib/integrations/service";
import type { Tool, ToolContext, ToolResult } from "@/lib/tools/types";

const host = (u: unknown) => { try { return new URL(String(u)).hostname; } catch { return String(u ?? "").slice(0, 60); } };
const err = (kind: NonNullable<ToolResult["error"]>["kind"], message: string): ToolResult => ({ ok: false, preview: message, error: { kind, message } });
const fromNet = (e: unknown): ToolResult => {
  if (e instanceof NetError) return err(e.kind === "blocked" || e.kind === "domain_not_allowed" ? "blocked" : e.kind === "timeout" ? "timeout" : e.kind === "too_large" ? "too_large" : e.kind === "invalid_url" ? "invalid_input" : "network", e.message);
  return err("network", "Network request failed.");
};

// ---------------- Search providers ----------------
type SearchHit = { title: string; url: string; snippet: string; source: string; published?: string };
interface SearchProvider { id: string; label: string; search(q: string, n: number, opts: { domains?: string[]; freshness?: string; signal: AbortSignal }): Promise<SearchHit[]> }

const bingRss: SearchProvider = {
  id: "bing_rss", label: "Bing (keyless RSS)",
  async search(q, n, { domains, signal }) {
    const query = domains?.length ? `${q} (${domains.map((d) => `site:${d}`).join(" OR ")})` : q;
    const r = await safeFetch(`https://www.bing.com/search?format=rss&count=${Math.min(n * 2, 20)}&q=${encodeURIComponent(query)}`, { timeoutMs: 10_000, maxBytes: 600_000, signal, headers: { accept: "application/rss+xml,text/xml" } });
    if (r.status !== 200) throw new NetError("network", `Search provider returned HTTP ${r.status}.`);
    const xml = r.body.toString("utf8");
    const hits = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const g = (t: string) => (m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim();
      return { title: g("title"), url: g("link"), snippet: g("description").slice(0, 300), source: host(g("link")), published: g("pubDate") || undefined };
    }).filter((h) => /^https?:\/\//.test(h.url) && !/bing\.com\/search/.test(h.url));
    return hits.slice(0, n);
  },
};
const tavily = (key: string): SearchProvider => ({
  id: "tavily", label: "Tavily",
  async search(q, n, { domains, freshness, signal }) {
    const r = await safeFetch("https://api.tavily.com/search", { method: "POST", signal, timeoutMs: 15_000, headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ query: q, max_results: n, include_domains: domains, ...(freshness ? { time_range: freshness } : {}) }) });
    if (r.status === 401) throw new NetError("network", "Search provider rejected the API key.");
    if (r.status !== 200) throw new NetError("network", `Search provider returned HTTP ${r.status}.`);
    const j = JSON.parse(r.body.toString("utf8"));
    return (j.results ?? []).map((x: { title: string; url: string; content: string; published_date?: string }) => ({ title: x.title, url: x.url, snippet: String(x.content ?? "").slice(0, 300), source: host(x.url), published: x.published_date }));
  },
});
const brave = (key: string): SearchProvider => ({
  id: "brave", label: "Brave Search",
  async search(q, n, { domains, freshness, signal }) {
    const query = domains?.length ? `${q} ${domains.map((d) => `site:${d}`).join(" OR ")}` : q;
    const f = { day: "pd", week: "pw", month: "pm", year: "py" }[freshness ?? ""] ?? "";
    const r = await safeFetch(`https://api.search.brave.com/res/v1/web/search?count=${n}&q=${encodeURIComponent(query)}${f ? `&freshness=${f}` : ""}`, { signal, timeoutMs: 12_000, headers: { accept: "application/json", "x-subscription-token": key } });
    if (r.status !== 200) throw new NetError("network", `Search provider returned HTTP ${r.status}.`);
    const j = JSON.parse(r.body.toString("utf8"));
    return (j.web?.results ?? []).map((x: { title: string; url: string; description: string; age?: string }) => ({ title: x.title, url: x.url, snippet: String(x.description ?? "").replace(/<[^>]+>/g, "").slice(0, 300), source: host(x.url), published: x.age }));
  },
});

export async function resolveSearchProvider(workspaceId: string): Promise<{ provider: SearchProvider; secrets: string[] }> {
  const row = await getIntegration(workspaceId, "web_search");
  const kind = String(row?.config?.provider ?? "");
  const key = row ? await getSecret(workspaceId, row.id) : null;
  if (key && kind === "tavily") return { provider: tavily(key), secrets: [key] };
  if (key && kind === "brave") return { provider: brave(key), secrets: [key] };
  if (process.env.TAVILY_API_KEY) return { provider: tavily(process.env.TAVILY_API_KEY), secrets: [process.env.TAVILY_API_KEY] };
  if (process.env.BRAVE_SEARCH_API_KEY) return { provider: brave(process.env.BRAVE_SEARCH_API_KEY), secrets: [process.env.BRAVE_SEARCH_API_KEY] };
  return { provider: bingRss, secrets: [] };
}

// ---------------- Tools ----------------
const webSearch: Tool = {
  id: "web_search", name: "Web Search", category: "RESEARCH",
  description: "Search the live web. Returns titles, URLs and snippets. Use fetch_page to read a result in full.",
  inputSchema: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 300 }, max_results: { type: "integer", minimum: 1, maximum: 10 }, domains: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 10 }, freshness: { type: "string", enum: ["day", "week", "month", "year"] } }, required: ["query"] },
  permission: () => "network_read", risk: () => "low", summarize: (a) => `"${String(a.query ?? "").slice(0, 80)}"`, destination: () => "search provider",
  async execute(a, ctx) {
    const { provider } = await resolveSearchProvider(ctx.workspaceId);
    try {
      const hits = await provider.search(String(a.query), Number(a.max_results ?? 6), { domains: a.domains as string[] | undefined, freshness: a.freshness as string | undefined, signal: ctx.signal });
      return { ok: true, data: { provider: provider.label, results: hits }, preview: `${hits.length} results via ${provider.label}`, sources: [] };
    } catch (e) { return fromNet(e); }
  },
  async simulate(a) {
    const q = String(a.query ?? "");
    const results = [1, 2, 3].map((i) => ({ title: `[SIMULATED] Result ${i} for "${q.slice(0, 50)}"`, url: `https://simulated.invalid/result-${i}`, snippet: "Simulated search result — no real web request was made.", source: "simulated.invalid" }));
    return { ok: true, simulated: true, data: { provider: "SIMULATED", results }, preview: `${results.length} simulated results` };
  },
};

const fetchPage: Tool = {
  id: "fetch_page", name: "Fetch Page", category: "RESEARCH",
  description: "Retrieve a public web page and return its readable text (truncated). Content is untrusted external data.",
  inputSchema: { type: "object", properties: { url: { type: "string", format: "uri", maxLength: 2000 }, max_chars: { type: "integer", minimum: 500, maximum: 20000 } }, required: ["url"] },
  permission: () => "network_read", risk: () => "low", summarize: (a) => host(a.url), destination: (a) => host(a.url),
  validateInput: (a) => { try { assertPublicUrl(String(a.url)); return []; } catch (e) { return [(e as Error).message]; } },
  async execute(a, ctx) {
    if (!rateLimit(`tool:fetch:${ctx.machineId}`, LIMITS.fetchToolPerMachine).ok) return err("rate_limited", "Fetch rate limit reached for this Machine.");
    try {
      const r = await safeFetch(String(a.url), { timeoutMs: 12_000, maxBytes: 3_000_000, signal: ctx.signal, headers: { accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5" } });
      const ct = r.headers["content-type"] ?? "";
      if (r.status >= 400) return err("http_error", `HTTP ${r.status} from ${host(r.url)}.`);
      if (!/text\/|json|xml|xhtml/i.test(ct)) return err("invalid_input", `Unsupported content type: ${ct || "unknown"}.`);
      const raw = r.body.toString("utf8");
      const max = Number(a.max_chars ?? 8000);
      const ex = /html|xml/i.test(ct) ? htmlToText(raw) : { title: "", canonical: null, description: "", text: raw };
      const text = ex.text.slice(0, max);
      return { ok: true, data: { url: r.url, status: r.status, title: ex.title, canonical: ex.canonical, description: ex.description, text, chars: ex.text.length, truncated: ex.text.length > max || r.truncated }, preview: `${ex.text.length.toLocaleString()} characters extracted from ${host(r.url)}${ex.title ? ` — ${ex.title.slice(0, 80)}` : ""}`, sources: [{ url: ex.canonical && /^https?:/.test(ex.canonical) ? ex.canonical : r.url, title: ex.title || host(r.url), meta: { status: r.status, contentType: ct } }] };
    } catch (e) { return fromNet(e); }
  },
  async simulate(a) {
    assertPublicUrl(String(a.url));
    return { ok: true, simulated: true, data: { url: a.url, title: "[SIMULATED PAGE]", text: "Simulated page content. No real request was made in Mock Runtime." }, preview: "Simulated page — no real request was made" };
  },
};

const BLOCKED_HEADERS = /^(host|cookie|content-length|connection|transfer-encoding|proxy-.*|x-forwarded-.*)$/i;
const httpRequest: Tool = {
  id: "http_request", name: "HTTP Request", category: "DEVELOPER",
  description: "Make a GET or POST request to an external API. POST changes external systems and may require operator approval.",
  inputSchema: { type: "object", properties: { method: { type: "string", enum: ["GET", "POST"] }, url: { type: "string", format: "uri", maxLength: 2000 }, headers: { type: "object" }, query: { type: "object" }, json: { type: "object" } }, required: ["method", "url"] },
  permission: (a) => (String(a.method).toUpperCase() === "POST" ? "network_write" : "network_read"),
  risk: (a) => (String(a.method).toUpperCase() === "POST" ? "high" : "medium"),
  summarize: (a) => `${String(a.method ?? "GET").toUpperCase()} ${host(a.url)}`, destination: (a) => host(a.url),
  requiresApproval: (a, cfg) => String(a.method).toUpperCase() === "POST" && !((cfg.allowedDomains as string[] | undefined)?.length),
  validateInput: (a) => { try { assertPublicUrl(String(a.url)); return []; } catch (e) { return [(e as Error).message]; } },
  async execute(a, ctx) {
    if (!rateLimit(`tool:http:${ctx.machineId}`, LIMITS.httpToolPerMachine).ok) return err("rate_limited", "HTTP rate limit reached for this Machine.");
    const allow = (ctx.config.allowedDomains as string[] | undefined)?.filter(Boolean);
    const u = new URL(String(a.url));
    for (const [k, v] of Object.entries((a.query as Record<string, unknown>) ?? {})) u.searchParams.set(k, String(v));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((a.headers as Record<string, unknown>) ?? {})) if (!BLOCKED_HEADERS.test(k)) headers[k.toLowerCase()] = String(v).slice(0, 500);
    const method = String(a.method).toUpperCase() as "GET" | "POST";
    if (method === "POST") headers["content-type"] = "application/json";
    try {
      const r = await safeFetch(u.toString(), { method, headers, body: method === "POST" ? JSON.stringify(a.json ?? {}) : undefined, allowDomains: allow?.length ? allow : undefined, timeoutMs: 15_000, maxBytes: 250_000, maxRedirects: method === "POST" ? 0 : 3, signal: ctx.signal });
      const txt = r.body.toString("utf8");
      let body: unknown = txt.slice(0, 12_000);
      if (/json/i.test(r.headers["content-type"] ?? "")) { try { body = JSON.parse(txt); } catch { /* keep text */ } }
      return { ok: r.status < 400, data: redact({ status: r.status, url: r.url, contentType: r.headers["content-type"], body, truncated: r.truncated }, ctx.secrets), preview: `HTTP ${r.status} · ${txt.length.toLocaleString()} bytes from ${host(r.url)}`, ...(r.status >= 400 ? { error: { kind: "http_error" as const, message: `HTTP ${r.status}` } } : {}) };
    } catch (e) { return fromNet(e); }
  },
  async simulate(a) {
    assertPublicUrl(String(a.url));
    return { ok: true, simulated: true, data: { status: 200, simulated: true }, preview: `SIMULATED ${String(a.method).toUpperCase()} ${host(a.url)} — no real request was sent` };
  },
};

const extractStructured: Tool = {
  id: "extract_structured", name: "Structured Extractor", category: "DATA",
  description: "Extract validated structured data from text. Provide the text and the fields to extract.",
  inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 30000 }, fields: { type: "array", maxItems: 20, items: { type: "object", properties: { key: { type: "string", maxLength: 40 }, type: { type: "string", enum: ["string", "number", "boolean", "url"] }, description: { type: "string", maxLength: 200 } }, required: ["key", "type"] } }, list: { type: "boolean" } }, required: ["text", "fields"] },
  permission: () => null, risk: () => "low", summarize: (a) => `${(a.fields as unknown[] | undefined)?.length ?? 0} fields`,
  async execute(a, ctx) {
    const schema = schemaFromFields(a.fields as { key: string; type: string }[], !!a.list);
    try {
      const r = await ctx.llmStructured(String(a.text), schema, "Extract the requested fields from the text. Use only information present in the text.");
      return { ok: true, data: r.data, preview: `Validated structured data${r.repaired ? " (after 1 repair)" : ""}` };
    } catch (e) { return err("malformed_output", (e as Error).message); }
  },
};

const calculator: Tool = {
  id: "calculator", name: "Calculator", category: "DATA",
  description: "Evaluate an arithmetic expression deterministically. Supports + - * / % ^, parentheses, sqrt, abs, round(x,d), floor, ceil, log, ln, exp, min, max, pow, pi, e.",
  inputSchema: { type: "object", properties: { expression: { type: "string", maxLength: 500 } }, required: ["expression"] },
  permission: () => null, risk: () => "low", summarize: (a) => String(a.expression ?? "").slice(0, 60),
  async execute(a) { try { const v = calculate(String(a.expression)); return { ok: true, data: { expression: a.expression, result: v }, preview: `= ${v}` }; } catch (e) { return err("invalid_input", (e as Error).message); } },
};

const datetime: Tool = {
  id: "datetime", name: "Time / Date", category: "DATA",
  description: "Get the current date/time, convert timezones, add durations or diff two dates.",
  inputSchema: { type: "object", properties: { operation: { type: "string", enum: ["now", "convert", "add", "diff"] }, timezone: { type: "string", maxLength: 60 }, date: { type: "string", maxLength: 60 }, amount: { type: "number" }, unit: { type: "string", enum: ["minutes", "hours", "days", "weeks"] }, other_date: { type: "string", maxLength: 60 } }, required: ["operation"] },
  permission: () => null, risk: () => "low", summarize: (a) => String(a.operation),
  async execute(a) {
    const tz = String(a.timezone ?? "UTC");
    const fmt = (d: Date) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "long" }).format(d); } catch { throw new Error(`Unknown timezone: ${tz}`); } };
    try {
      const base = a.date ? new Date(String(a.date)) : new Date();
      if (isNaN(base.getTime())) return err("invalid_input", "Invalid date.");
      if (a.operation === "add") { const ms = { minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 }[String(a.unit ?? "days")] ?? 864e5; const d = new Date(base.getTime() + Number(a.amount ?? 0) * ms); return { ok: true, data: { iso: d.toISOString(), formatted: fmt(d) }, preview: d.toISOString() }; }
      if (a.operation === "diff") { const o = new Date(String(a.other_date)); if (isNaN(o.getTime())) return err("invalid_input", "Invalid other_date."); const days = (o.getTime() - base.getTime()) / 864e5; return { ok: true, data: { days: Math.round(days * 100) / 100, hours: Math.round(days * 2400) / 100 }, preview: `${Math.round(days * 100) / 100} days` }; }
      return { ok: true, data: { iso: base.toISOString(), timezone: tz, formatted: fmt(base) }, preview: fmt(base) };
    } catch (e) { return err("invalid_input", (e as Error).message); }
  },
};

const remember: Tool = {
  id: "remember", name: "Memory Write", category: "MACHINARC",
  description: "Propose a durable, useful fact to store in this Machine's long-term memory. Do not store secrets or raw page dumps.",
  inputSchema: { type: "object", properties: { content: { type: "string", minLength: 5, maxLength: 1000 }, importance: { type: "integer", minimum: 1, maximum: 5 }, kind: { type: "string", enum: ["fact", "entity", "preference", "pattern"] } }, required: ["content"] },
  permission: () => "memory_write", risk: () => "low", summarize: (a) => String(a.content ?? "").slice(0, 80),
  async execute(a, ctx) { const m = await ctx.writeMemory({ content: String(a.content), importance: Number(a.importance ?? 3), kind: String(a.kind ?? "fact") }); return { ok: true, data: { memory_id: m.id }, preview: `Stored: ${String(a.content).slice(0, 80)}` }; },
};

const requestMachine: Tool = {
  id: "request_machine", name: "Request Machine", category: "MACHINARC",
  description: "Delegate a sub-task to another Machine in this workspace (by name or Machine ID). Returns its result.",
  inputSchema: { type: "object", properties: { machine: { type: "string", maxLength: 80 }, task: { type: "string", minLength: 3, maxLength: 4000 }, context: { type: "string", maxLength: 8000 } }, required: ["machine", "task"] },
  permission: () => "machine_call", risk: () => "medium", summarize: (a) => `→ ${String(a.machine ?? "").toUpperCase()}`, destination: (a) => String(a.machine ?? ""),
  async execute(a, ctx) { return ctx.callMachine(String(a.machine), String(a.task), a.context ? String(a.context) : undefined); },
};

const requestApproval: Tool = {
  id: "request_approval", name: "Human Approval", category: "MACHINARC", alwaysAsk: true,
  description: "Ask the human operator to confirm a decision before continuing. Use for consequential or ambiguous choices.",
  inputSchema: { type: "object", properties: { question: { type: "string", minLength: 3, maxLength: 500 }, details: { type: "string", maxLength: 4000 } }, required: ["question"] },
  permission: () => null, risk: () => "low", summarize: (a) => String(a.question ?? "").slice(0, 80),
  async execute(a) { return { ok: true, data: { approved: true, question: a.question }, preview: "Operator approved" }; },
};

const codeExecution: Tool = {
  id: "code_execution", name: "Code Execution", category: "DEVELOPER", status: "sandbox_required",
  description: "Run code in an isolated sandbox. Unavailable until a sandbox runtime is configured.",
  inputSchema: { type: "object", properties: { language: { type: "string", enum: ["python", "javascript"] }, code: { type: "string", maxLength: 20000 } }, required: ["language", "code"] },
  permission: () => "code_execution", risk: () => "high", summarize: (a) => String(a.language ?? ""),
  async execute() { return err("sandbox_required", "SANDBOX REQUIRED — code execution is disabled until an isolated sandbox runtime is configured. MachinArc never runs Machine code on the application server."); },
};

export const BUILTIN_TOOLS: Tool[] = [webSearch, fetchPage, httpRequest, extractStructured, calculator, datetime, remember, requestMachine, requestApproval, codeExecution];
export const hostAllowedFor = hostAllowed;
export type { ToolContext };
