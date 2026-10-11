"use server";
import { enqueue } from "@/lib/queue/queue";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, approvalRequests, machineMemories, machinePermissions, machineRuns, machines, machineTools, workspaceIntegrations } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { MachineRuntime, RuntimeError } from "@/lib/runtime/machine-runtime";
import { PERSISTABLE } from "@/lib/runtime/permissions";
import { PERMISSIONS, TOOL_CATALOG } from "@/config/tools";
import { cleanDomains } from "@/lib/machines/service";
import { clearSecret, ensureIntegration, getIntegration, isDemoWorkspace, setSecret } from "@/lib/integrations/service";
import { OpenAIProvider, AnthropicProvider } from "@/lib/ai/providers";
import { ProviderError } from "@/lib/ai/types";
import { slugify, type CustomApiConfig } from "@/lib/tools/registry";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { obs } from "@/lib/security/redact";

type R = { ok: true } | { ok: false; error: string };
const fail = (where: string, e: unknown, fallback: string): R => { if (e instanceof RuntimeError) return { ok: false, error: e.userMessage }; obs(`action.${where}.error`, { error: String(e) }); return { ok: false, error: fallback }; };

async function ownMachine(machineId: string, workspaceId: string) {
  const [m] = await db.select().from(machines).where(and(eq(machines.id, machineId), eq(machines.workspaceId, workspaceId)));
  if (!m) throw new RuntimeError("Machine not found.");
  return m;
}

// ---------------- Runs ----------------
export async function stopRunAction(runId: string): Promise<R> {
  const s = await requireSession();
  try { await MachineRuntime.requestCancel(runId, s.workspace.id); return { ok: true }; }
  catch (e) { return fail("stopRun", e, "The run could not be stopped."); }
}

/** Operator decision on a tool authorization request. Only workspace operators can decide; Machines cannot. */
export async function decideToolApprovalAction(approvalId: string, decision: "deny" | "approve_once" | "approve_run" | "always"): Promise<R> {
  const s = await requireSession();
  if (!["deny", "approve_once", "approve_run", "always"].includes(decision)) return { ok: false, error: "Invalid decision." };
  const [ap] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.workspaceId, s.workspace.id)));
  if (!ap) return { ok: false, error: "Approval not found." };
  if (ap.status !== "pending") return { ok: false, error: "This request has already been decided." };
  if (decision === "always" && !PERSISTABLE.includes(ap.permission as never)) return { ok: false, error: "This permission cannot be permanently allowed from an approval. Edit the Machine's permissions instead." };
  const approved = decision !== "deny";
  const [claimed] = await db.update(approvalRequests).set({ status: approved ? "approved" : "denied", decision, decidedBy: s.user.id, decidedAt: new Date() })
    .where(and(eq(approvalRequests.id, ap.id), eq(approvalRequests.status, "pending"))).returning();
  if (!claimed) return { ok: false, error: "This request has already been decided." };
  if (decision === "always") {
    await db.update(machinePermissions).set({ mode: "ALLOW" }).where(and(eq(machinePermissions.machineId, ap.machineId), eq(machinePermissions.permission, ap.permission)));
    await db.insert(activities).values({ workspaceId: s.workspace.id, category: "security", actor: s.user.name, message: `Operator set ${ap.permission} → ALLOW permanently for Machine ${ap.machineId.slice(0, 8)}.`, severity: "warning" });
  }
  await db.insert(activities).values({ workspaceId: s.workspace.id, machineId: ap.machineId, category: "security", actor: s.user.name, message: `Operator ${approved ? "approved" : "denied"} ${ap.toolId}${ap.destination ? ` → ${ap.destination}` : ""} (${decision.replace("_", " ")}).`, severity: approved ? "success" : "warning" });
  obs("approval.resolved", { approvalId, decision, operator: s.user.id });
  if (ap.kind === "network_hire" || !ap.machineRunId) {
    // Catalog hires are demonstrations, even when an operator approves them.
    let result = "denied";
    if (approved) {
      const rt = await MachineRuntime.load(ap.machineId, s.workspace.id);
      const args = (ap.arguments ?? {}) as { code?: string; purpose?: string };
      result = (await rt.requestMachine(String(args.code), String(args.purpose ?? ap.purpose), { skipApproval: true })).status;
    }
    await db.update(approvalRequests).set({ result }).where(eq(approvalRequests.id, ap.id));
  } else {
    // Flip status so the run can be claimed, then resume durably through the queue.
    await db.update(machineRuns).set({ status: "running" }).where(and(eq(machineRuns.id, ap.machineRunId), eq(machineRuns.status, "waiting_approval")));
    await enqueue("machine.execute", { runId: ap.machineRunId }, { workspaceId: s.workspace.id, dedupeKey: `machine:${ap.machineRunId}` });
  }
  revalidatePath(`/app/machines/${ap.machineId}`);
  return { ok: true };
}

// ---------------- Machine configuration ----------------
export async function setPermissionModeAction(machineId: string, permission: string, mode: "DENY" | "ASK" | "ALLOW"): Promise<R> {
  const s = await requireSession();
  try {
    const m = await ownMachine(machineId, s.workspace.id);
    if (!PERMISSIONS.some((p) => p.key === permission) || !["DENY", "ASK", "ALLOW"].includes(mode)) return { ok: false, error: "Invalid permission." };
    const [ex] = await db.select().from(machinePermissions).where(and(eq(machinePermissions.machineId, m.id), eq(machinePermissions.permission, permission)));
    if (ex) await db.update(machinePermissions).set({ mode }).where(eq(machinePermissions.id, ex.id));
    else await db.insert(machinePermissions).values({ machineId: m.id, permission, mode });
    await db.insert(activities).values({ workspaceId: s.workspace.id, machineId: m.id, category: "security", actor: s.user.name, message: `Operator set ${m.name} · ${permission} → ${mode}.` });
    revalidatePath(`/app/machines/${machineId}`);
    return { ok: true };
  } catch (e) { return fail("perm", e, "Permission could not be updated."); }
}

export async function setMachineToolAction(machineId: string, toolId: string, enabled: boolean, allowedDomains?: string[]): Promise<R> {
  const s = await requireSession();
  try {
    const m = await ownMachine(machineId, s.workspace.id);
    const meta = TOOL_CATALOG.find((t) => t.id === toolId);
    if (meta?.status === "sandbox_required") return { ok: false, error: "SANDBOX REQUIRED — this tool cannot be enabled until a sandbox runtime is configured." };
    if (!meta) {
      if (!/^api__[a-z0-9_]{1,24}$/.test(toolId)) return { ok: false, error: "Unknown tool." };
      const api = await getIntegration(s.workspace.id, toolId.slice(5));
      if (!api || api.kind !== "custom_api") return { ok: false, error: "Custom API not found in this workspace." };
    }
    const [ex] = await db.select().from(machineTools).where(and(eq(machineTools.machineId, m.id), eq(machineTools.tool, toolId)));
    const config = allowedDomains ? { allowedDomains: cleanDomains(allowedDomains) } : ex?.config ?? {};
    if (ex) await db.update(machineTools).set({ enabled, config }).where(eq(machineTools.id, ex.id));
    else await db.insert(machineTools).values({ machineId: m.id, tool: toolId, enabled, permission: meta?.level ?? "WRITE", config });
    revalidatePath(`/app/machines/${machineId}`);
    return { ok: true };
  } catch (e) { return fail("tool", e, "Tool could not be updated."); }
}

export async function updateMachineLimitsAction(machineId: string, f: { maxRuntimeSec: number; maxToolCalls: number; maxTurns: number; maxTaskCost: number; memoryMode: string }): Promise<R> {
  const s = await requireSession();
  try {
    const m = await ownMachine(machineId, s.workspace.id);
    if (!(f.maxRuntimeSec >= 10 && f.maxRuntimeSec <= 900) || !(f.maxToolCalls >= 0 && f.maxToolCalls <= 50) || !(f.maxTurns >= 1 && f.maxTurns <= 30) || !(f.maxTaskCost > 0)) return { ok: false, error: "Limits out of range (runtime 10–900s, tool calls 0–50, turns 1–30, task cost > 0)." };
    if (!["none", "session", "persistent", "structured"].includes(f.memoryMode)) return { ok: false, error: "Invalid memory mode." };
    await db.update(machines).set({ maxRuntimeSec: Math.round(f.maxRuntimeSec), maxToolCalls: Math.round(f.maxToolCalls), maxTurns: Math.round(f.maxTurns), maxTaskCost: f.maxTaskCost, memoryMode: f.memoryMode, updatedAt: new Date() }).where(eq(machines.id, m.id));
    revalidatePath(`/app/machines/${machineId}`);
    return { ok: true };
  } catch (e) { return fail("limits", e, "Limits could not be saved."); }
}

// ---------------- Memory ----------------
export async function saveMemoryAction(machineId: string, f: { id?: string; content: string; importance: number; kind: string }): Promise<R> {
  const s = await requireSession();
  try {
    const m = await ownMachine(machineId, s.workspace.id);
    const content = f.content.trim().slice(0, 1000);
    if (content.length < 3) return { ok: false, error: "Memory content is too short." };
    const importance = Math.max(1, Math.min(5, Math.round(f.importance || 3)));
    const kind = ["fact", "entity", "preference", "pattern"].includes(f.kind) ? f.kind : "fact";
    if (f.id) await db.update(machineMemories).set({ content, summary: content.slice(0, 140), importance, kind }).where(and(eq(machineMemories.id, f.id), eq(machineMemories.machineId, m.id)));
    else await db.insert(machineMemories).values({ machineId: m.id, workspaceId: s.workspace.id, content, summary: content.slice(0, 140), importance, kind, source: "operator" });
    revalidatePath(`/app/machines/${machineId}`);
    return { ok: true };
  } catch (e) { return fail("memory", e, "Memory could not be saved."); }
}
export async function deleteMemoryAction(machineId: string, id: string): Promise<R> {
  const s = await requireSession();
  try { const m = await ownMachine(machineId, s.workspace.id); await db.delete(machineMemories).where(and(eq(machineMemories.id, id), eq(machineMemories.machineId, m.id))); revalidatePath(`/app/machines/${machineId}`); return { ok: true }; }
  catch (e) { return fail("memoryDelete", e, "Memory could not be deleted."); }
}
export async function pinMemoryAction(machineId: string, id: string, pinned: boolean): Promise<R> {
  const s = await requireSession();
  try { const m = await ownMachine(machineId, s.workspace.id); await db.update(machineMemories).set({ pinned }).where(and(eq(machineMemories.id, id), eq(machineMemories.machineId, m.id))); revalidatePath(`/app/machines/${machineId}`); return { ok: true }; }
  catch (e) { return fail("memoryPin", e, "Memory could not be updated."); }
}

// ---------------- Integrations ----------------
export async function connectProviderAction(provider: "openai" | "anthropic", apiKey: string): Promise<R> {
  const s = await requireSession();
  if (await isDemoWorkspace(s.workspace.id)) return { ok: false, error: "Demo integrations are simulated. Create an account to connect credentials." };
  if (provider !== "openai" && provider !== "anthropic") return { ok: false, error: "Unknown provider." };
  const key = apiKey.trim();
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) return { ok: false, error: "That does not look like a valid API key." };
  if (!rateLimit(`integration:${s.workspace.id}`, LIMITS.integrationTest).ok) return { ok: false, error: "Too many connection attempts. Wait a minute." };
  try {
    const p = provider === "openai" ? new OpenAIProvider(key) : new AnthropicProvider(key);
    await p.generate({ model: provider === "openai" ? "gpt-4.1-mini" : "claude-haiku-4-5", messages: [{ role: "user", content: "Reply with OK." }], maxOutputTokens: 16, timeoutMs: 20_000 });
  } catch (e) {
    if (e instanceof ProviderError && (e.kind === "auth" || e.kind === "bad_request")) return { ok: false, error: e.kind === "auth" ? "AUTHENTICATION ERROR — the provider rejected this key." : "The provider rejected the verification request." };
    if (!(e instanceof ProviderError && (e.kind === "quota" || e.kind === "rate_limit" || e.kind === "invalid_model"))) return { ok: false, error: "Could not verify the key — the provider is unreachable. Try again." };
  }
  const row = await ensureIntegration(s.workspace.id, provider, "ai_provider", provider === "openai" ? "OpenAI" : "Anthropic");
  await setSecret(s.workspace.id, row.id, key);
  await db.update(workspaceIntegrations).set({ status: "connected", lastSuccessAt: new Date(), lastError: null, config: { mode: "workspace" }, updatedAt: new Date() }).where(eq(workspaceIntegrations.id, row.id));
  await db.insert(activities).values({ workspaceId: s.workspace.id, category: "system", actor: s.user.name, message: `${row.name} connected.`, severity: "success" });
  revalidatePath("/app/settings/integrations");
  return { ok: true };
}

export async function disconnectIntegrationAction(slug: string): Promise<R> {
  const s = await requireSession();
  const row = await getIntegration(s.workspace.id, slug);
  if (!row) return { ok: false, error: "Not connected." };
  await clearSecret(s.workspace.id, row.id);
  if (row.kind === "custom_api") await db.delete(workspaceIntegrations).where(eq(workspaceIntegrations.id, row.id));
  else await db.update(workspaceIntegrations).set({ status: "not_connected", config: {}, updatedAt: new Date() }).where(eq(workspaceIntegrations.id, row.id));
  revalidatePath("/app/settings/integrations");
  return { ok: true };
}

export async function configureSearchAction(provider: "bing_rss" | "tavily" | "brave", apiKey?: string): Promise<R> {
  const s = await requireSession();
  if (await isDemoWorkspace(s.workspace.id)) return { ok: false, error: "Demo integrations are simulated. Create an account to configure search." };
  if (!["bing_rss", "tavily", "brave"].includes(provider)) return { ok: false, error: "Unknown search provider." };
  if (provider !== "bing_rss" && (!apiKey || apiKey.trim().length < 10)) return { ok: false, error: "An API key is required for this provider." };
  const row = await ensureIntegration(s.workspace.id, "web_search", "tool", "Web Search");
  if (apiKey && provider !== "bing_rss") await setSecret(s.workspace.id, row.id, apiKey.trim()); else await clearSecret(s.workspace.id, row.id);
  await db.update(workspaceIntegrations).set({ status: "connected", config: { provider }, updatedAt: new Date() }).where(eq(workspaceIntegrations.id, row.id));
  revalidatePath("/app/settings/integrations");
  return { ok: true };
}

export async function saveCustomApiAction(f: { name: string; config: CustomApiConfig; secret?: string }): Promise<R> {
  const s = await requireSession();
  if (await isDemoWorkspace(s.workspace.id)) return { ok: false, error: "Demo integrations are simulated. Create an account to connect APIs." };
  const name = f.name.trim().slice(0, 40);
  if (name.length < 2) return { ok: false, error: "Name the API." };
  let base: URL;
  try { base = new URL(f.config.baseUrl); } catch { return { ok: false, error: "Base URL is invalid." }; }
  if (base.protocol !== "https:") return { ok: false, error: "Custom APIs must use https." };
  const actions = (f.config.actions ?? []).slice(0, 20).map((a) => ({
    name: a.name.trim().slice(0, 40), method: a.method === "POST" ? "POST" as const : "GET" as const, path: a.path.trim().slice(0, 200), description: a.description.trim().slice(0, 300),
    params: (a.params ?? []).slice(0, 20).filter((p) => /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(p.name)).map((p) => ({ name: p.name, in: (["path", "query", "body"].includes(p.in) ? p.in : "query") as "path" | "query" | "body", type: (["string", "number", "boolean"].includes(p.type) ? p.type : "string") as "string" | "number" | "boolean", required: !!p.required, description: p.description?.slice(0, 200) })),
  })).filter((a) => a.name && a.path);
  if (!actions.length) return { ok: false, error: "Add at least one action with a name and path." };
  const slug = slugify(name);
  const config: CustomApiConfig = { description: f.config.description?.slice(0, 300) ?? "", baseUrl: base.toString().replace(/\/$/, ""), allowedDomains: cleanDomains(f.config.allowedDomains), authType: ["none", "bearer", "header", "query"].includes(f.config.authType) ? f.config.authType : "none", authName: f.config.authName?.slice(0, 60), headers: Object.fromEntries(Object.entries(f.config.headers ?? {}).filter(([k]) => !/^(authorization|cookie|host)$/i.test(k)).slice(0, 10)), actions };
  const row = await ensureIntegration(s.workspace.id, slug, "custom_api", name);
  if (row.kind !== "custom_api") return { ok: false, error: "That name is reserved. Choose another." };
  await db.update(workspaceIntegrations).set({ name, config: config as unknown as Record<string, unknown>, status: config.authType !== "none" && !f.secret ? "configuration_required" : "connected", updatedAt: new Date() }).where(eq(workspaceIntegrations.id, row.id));
  if (f.secret?.trim()) { await setSecret(s.workspace.id, row.id, f.secret.trim()); await db.update(workspaceIntegrations).set({ status: "connected" }).where(eq(workspaceIntegrations.id, row.id)); }
  revalidatePath("/app/settings/integrations");
  return { ok: true };
}
