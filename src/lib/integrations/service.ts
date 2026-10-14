import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationCredentials, workspaceIntegrations, workspaceMembers, workspaces, users } from "@/db/schema";
import { PROVIDERS, type ProviderId } from "@/config/models";
import { decrypt, encrypt, hintOf } from "@/lib/security/crypto";
import { AnthropicProvider, MockProvider, OpenAIProvider } from "@/lib/ai/providers";
import { ProviderError, type AIProvider } from "@/lib/ai/types";
import { obs } from "@/lib/security/redact";
import { ChatgptProvider } from "@/lib/ai/chatgpt-provider";
import { assertLocalChatgpt, chatgptAccess } from "@/lib/integrations/chatgpt-local";

export type IntegrationStatus = "connected" | "not_connected" | "configuration_required" | "error" | "auth_error";

export async function isDemoWorkspace(workspaceId: string): Promise<boolean> {
  const [workspace] = await db.select({ policy: workspaces.policy }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (workspace?.policy.demo) return true;
  // Also shield previously seeded demos whose policy predates the marker.
  const [legacy] = await db.select({ id: users.id }).from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, "demo@machinarcpro.com"))).limit(1);
  return !!legacy;
}

export async function getIntegration(workspaceId: string, slug: string) {
  const [row] = await db.select().from(workspaceIntegrations).where(and(eq(workspaceIntegrations.workspaceId, workspaceId), eq(workspaceIntegrations.slug, slug)));
  return row ?? null;
}

export async function ensureIntegration(workspaceId: string, slug: string, kind: string, name: string) {
  const ex = await getIntegration(workspaceId, slug);
  if (ex) return ex;
  const [row] = await db.insert(workspaceIntegrations).values({ workspaceId, slug, kind, name }).onConflictDoNothing().returning();
  return row ?? (await getIntegration(workspaceId, slug))!;
}

/** Decrypts a credential. Server-only — never return the result to a client. */
export async function getSecret(workspaceId: string, integrationId: string): Promise<string | null> {
  if (await isDemoWorkspace(workspaceId)) return null;
  const [c] = await db.select().from(integrationCredentials).where(and(eq(integrationCredentials.integrationId, integrationId), eq(integrationCredentials.workspaceId, workspaceId)));
  if (!c) return null;
  try { return decrypt(c); } catch { obs("credential.decrypt_failed", { integrationId }); return null; }
}

export async function setSecret(workspaceId: string, integrationId: string, secret: string) {
  if (await isDemoWorkspace(workspaceId)) throw new Error("Demo workspaces cannot store credentials.");
  const e = encrypt(secret);
  await db.insert(integrationCredentials).values({ workspaceId, integrationId, ...e, hint: hintOf(secret) })
    .onConflictDoUpdate({ target: integrationCredentials.integrationId, set: { ...e, hint: hintOf(secret), createdAt: new Date() } });
}

export async function clearSecret(workspaceId: string, integrationId: string) {
  await db.delete(integrationCredentials).where(and(eq(integrationCredentials.integrationId, integrationId), eq(integrationCredentials.workspaceId, workspaceId)));
}

export async function secretHint(workspaceId: string, integrationId: string) {
  const [c] = await db.select({ hint: integrationCredentials.hint }).from(integrationCredentials).where(and(eq(integrationCredentials.integrationId, integrationId), eq(integrationCredentials.workspaceId, workspaceId)));
  return c?.hint ?? null;
}

export type ResolvedProvider = { provider: AIProvider; mode: "workspace" | "platform" | "mock"; requested: string; fallback: boolean; secrets: string[] };

/** Workspace credential > platform env key > Mock Runtime (clearly labeled fallback). */
export async function resolveProvider(workspaceId: string, requested: string): Promise<ResolvedProvider> {
  if (await isDemoWorkspace(workspaceId)) return { provider: new MockProvider(), mode: "mock", requested, fallback: requested !== "mock", secrets: [] };
  if (requested === "chatgpt") {
    assertLocalChatgpt();
    const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    if (members.length !== 1 || members[0].role !== "owner") throw new ProviderError("auth", "ChatGPT plan use is limited to a personal local workspace with one owner.");
    const access = await chatgptAccess(workspaceId); // Fail before resuming pending tools after disconnect or invalid refresh.
    return { provider: new ChatgptProvider(workspaceId), mode: "workspace", requested, fallback: false, secrets: [access.token] };
  }
  if (requested === "openai" || requested === "anthropic") {
    const row = await getIntegration(workspaceId, requested);
    const ws = row ? await getSecret(workspaceId, row.id) : null;
    const key = ws ?? process.env[PROVIDERS[requested as ProviderId].envKey!] ?? null;
    if (key) return { provider: requested === "openai" ? new OpenAIProvider(key) : new AnthropicProvider(key), mode: ws ? "workspace" : "platform", requested, fallback: false, secrets: [key] };
  }
  return { provider: new MockProvider(), mode: "mock", requested, fallback: requested !== "mock", secrets: [] };
}

export async function providerConfigured(workspaceId: string, p: "openai" | "anthropic") {
  if (await isDemoWorkspace(workspaceId)) return null;
  const row = await getIntegration(workspaceId, p);
  if (row && (await secretHint(workspaceId, row.id))) return "workspace" as const;
  return process.env[PROVIDERS[p].envKey!] ? ("platform" as const) : null;
}

/** Records provider health after each request (never stores error bodies containing secrets). */
export async function reportProviderHealth(workspaceId: string, p: string, ok: boolean, errorKind?: string, message?: string) {
  if (p !== "openai" && p !== "anthropic") return;
  const row = await ensureIntegration(workspaceId, p, "ai_provider", PROVIDERS[p as ProviderId].label);
  if (ok) await db.update(workspaceIntegrations).set({ status: "connected", lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(workspaceIntegrations.id, row.id));
  else if (errorKind === "auth" || errorKind === "quota" || errorKind === "invalid_model" || errorKind === "unavailable")
    await db.update(workspaceIntegrations).set({ status: errorKind === "auth" ? "auth_error" : "error", lastErrorAt: new Date(), lastError: (message ?? errorKind ?? "").slice(0, 200), updatedAt: new Date() }).where(eq(workspaceIntegrations.id, row.id));
}
