import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceIntegrations } from "@/db/schema";
import { BUILTIN_TOOLS } from "@/lib/tools/builtin";
import { safeFetch, NetError } from "@/lib/security/net";
import { getSecret } from "@/lib/integrations/service";
import { redact } from "@/lib/security/redact";
import type { JSONSchema } from "@/lib/tools/schema";
import type { Tool, ToolResult } from "@/lib/tools/types";

export type CustomApiConfig = {
  description: string; baseUrl: string; allowedDomains: string[]; authType: "none" | "bearer" | "header" | "query"; authName?: string;
  headers?: Record<string, string>;
  actions: { name: string; method: "GET" | "POST"; path: string; description: string; params: { name: string; in: "path" | "query" | "body"; type: "string" | "number" | "boolean"; required?: boolean; description?: string }[] }[];
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "api";

/** Builds one Tool per Custom API action. Credentials are injected server-side and never shown to the model. */
function customApiTools(row: typeof workspaceIntegrations.$inferSelect): Tool[] {
  const cfg = row.config as unknown as CustomApiConfig;
  if (!cfg?.baseUrl || !Array.isArray(cfg.actions)) return [];
  const base = new URL(cfg.baseUrl);
  const allow = [...new Set([base.hostname, ...(cfg.allowedDomains ?? [])].filter(Boolean))];
  return cfg.actions.map((act) => {
    const id = `api__${row.slug}__${slugify(act.name)}`;
    const schema: JSONSchema = { type: "object", properties: Object.fromEntries(act.params.map((p) => [p.name, { type: p.type, description: p.description } as JSONSchema])), required: act.params.filter((p) => p.required).map((p) => p.name) };
    return {
      id, name: `${row.name} · ${act.name}`, category: "DEVELOPER", description: `${act.description} (${row.name} API)`.slice(0, 500), inputSchema: schema,
      permission: () => (act.method === "GET" ? "network_read" : "network_write"), risk: () => (act.method === "GET" ? "medium" : "high"),
      summarize: () => `${act.method} ${base.hostname}${act.path}`, destination: () => base.hostname,
      async execute(a, ctx): Promise<ToolResult> {
        const secret = await getSecret(ctx.workspaceId, row.id);
        let path = act.path;
        const u = new URL(cfg.baseUrl.replace(/\/$/, ""));
        const body: Record<string, unknown> = {};
        for (const p of act.params) {
          const v = a[p.name];
          if (v === undefined) continue;
          if (p.in === "path") path = path.replace(new RegExp(`\\{\\{?\\s*${p.name}\\s*\\}?\\}`, "g"), encodeURIComponent(String(v)));
          else if (p.in === "query") u.searchParams.set(p.name, String(v));
          else body[p.name] = v;
        }
        if (/\{/.test(path)) return { ok: false, preview: "Missing path parameter.", error: { kind: "invalid_input", message: "Missing required path parameter." } };
        u.pathname = `${u.pathname.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
        const headers: Record<string, string> = { accept: "application/json", ...(cfg.headers ?? {}) };
        if (secret && cfg.authType === "bearer") headers.authorization = `Bearer ${secret}`;
        if (secret && cfg.authType === "header") headers[(cfg.authName || "x-api-key").toLowerCase()] = secret;
        if (secret && cfg.authType === "query") u.searchParams.set(cfg.authName || "api_key", secret);
        if (act.method === "POST") headers["content-type"] = "application/json";
        const secrets = [...ctx.secrets, ...(secret ? [secret] : [])];
        try {
          const r = await safeFetch(u.toString(), { method: act.method, headers, body: act.method === "POST" ? JSON.stringify(body) : undefined, allowDomains: allow, timeoutMs: 15_000, maxBytes: 250_000, maxRedirects: act.method === "POST" ? 0 : 2, signal: ctx.signal });
          const txt = r.body.toString("utf8");
          let parsed: unknown = txt.slice(0, 12_000);
          try { parsed = JSON.parse(txt); } catch { /* text */ }
          const safeUrl = redact(r.url, secrets);
          return { ok: r.status < 400, data: redact({ status: r.status, url: safeUrl, body: parsed }, secrets), preview: `HTTP ${r.status} from ${base.hostname}`, ...(r.status >= 400 ? { error: { kind: "http_error" as const, message: `HTTP ${r.status}` } } : {}) };
        } catch (e) {
          const m = e instanceof NetError ? e.message : "Network request failed.";
          return { ok: false, preview: m, error: { kind: e instanceof NetError && e.kind === "timeout" ? "timeout" : e instanceof NetError && (e.kind === "blocked" || e.kind === "domain_not_allowed") ? "blocked" : "network", message: redact(m, secrets) } };
        }
      },
      async simulate() { return { ok: true, simulated: true, data: { status: 200, simulated: true }, preview: `SIMULATED ${act.method} ${base.hostname}${act.path} — no real request was sent` }; },
    } satisfies Tool;
  });
}

export const ToolRegistry = {
  builtin: BUILTIN_TOOLS,
  get(id: string) { return BUILTIN_TOOLS.find((t) => t.id === id); },
  async customApis(workspaceId: string) {
    return db.select().from(workspaceIntegrations).where(and(eq(workspaceIntegrations.workspaceId, workspaceId), eq(workspaceIntegrations.kind, "custom_api")));
  },
  /** Resolves enabled tools for a Machine. Custom APIs are enabled as `api__<slug>` and expand to one tool per action. */
  async forMachine(workspaceId: string, enabled: { tool: string; config: Record<string, unknown> }[]) {
    const out: { tool: Tool; config: Record<string, unknown> }[] = [];
    const apis = enabled.some((e) => e.tool.startsWith("api__")) ? await this.customApis(workspaceId) : [];
    for (const e of enabled) {
      const b = this.get(e.tool);
      if (b) { out.push({ tool: b, config: e.config }); continue; }
      if (e.tool.startsWith("api__")) { const row = apis.find((r) => `api__${r.slug}` === e.tool); if (row) for (const t of customApiTools(row)) out.push({ tool: t, config: e.config }); }
    }
    return out;
  },
};
export { slugify };
