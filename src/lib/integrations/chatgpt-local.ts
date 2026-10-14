import "server-only";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { encrypt, decrypt, encryptionKeyConfigured } from "@/lib/security/crypto";
import { ProviderError } from "@/lib/ai/types";
import type { ModelDef } from "@/config/models";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
type Account = { clientId: string; subject: string; email: string; accessToken?: string; refreshToken?: string; idToken?: string; expiresAt: number; scopes: string[]; models: ModelDef[] };
type Store = { hostId: string; active?: string; accounts: Record<string, Account> };
type Attempt = { workspaceId: string; userId: string; state: string; nonce: string; verifier: string; redirectUri: string; expiresAt: number; clientId?: string; subject?: string };
const runtime = globalThis as typeof globalThis & { marcChatgptAttempts?: Map<string, Attempt> };
const attempts = runtime.marcChatgptAttempts ??= new Map<string, Attempt>();

export function localChatgptEnabled() {
  if (process.env.MARC_CHATGPT_LOCAL !== "1" || process.env.NODE_ENV === "production" || process.env.VERCEL || !encryptionKeyConfigured()) return false;
  try {
    const database = new URL(process.env.DATABASE_URL ?? "");
    return ["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || database.pathname === "/machinarc_local";
  } catch { return false; }
}
export function assertLocalChatgpt(origin?: string) {
  if (!localChatgptEnabled()) throw new ProviderError("auth", "ChatGPT integration requires explicit local opt-in and an encryption key; hosted use is disabled.");
  if (origin) {
    const url = new URL(origin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new ProviderError("auth", "Open the local app at http://127.0.0.1 before connecting ChatGPT.");
  }
}
/** NextURL normalizes loopback IPs to localhost; preserve the validated browser authority. */
export function localChatgptRequestUrl(request: Request) {
  const host = request.headers.get("host");
  if (!host || !/^127\.0\.0\.1(?::\d{1,5})?$/.test(host)) throw new ProviderError("auth", "Use the HTTP 127.0.0.1 origin for local ChatGPT sign-in.");
  const url = new URL(request.url); url.host = host;
  assertLocalChatgpt(url.origin); return url;
}
function directory() { return process.env.MARC_CHATGPT_LOCAL_DIR || join(homedir(), ".machinarc", "chatgpt"); }
function file(workspaceId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(workspaceId)) throw new Error("Invalid workspace identifier.");
  return join(directory(), `${workspaceId}.json`);
}
async function load(workspaceId: string): Promise<Store> {
  try { return JSON.parse(decrypt(JSON.parse(await readFile(file(workspaceId), "utf8")))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { hostId: `urn:uuid:${randomUUID()}`, accounts: {} }; throw new ProviderError("auth", "Local ChatGPT credentials could not be read. Restore the local encryption key."); }
}
async function save(workspaceId: string, store: Store) {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const target = file(workspaceId), temp = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(encrypt(JSON.stringify(store))), { mode: 0o600, flag: "wx" }); await rename(temp, target); }
  finally { await rm(temp, { force: true }); }
}
// Separate local app and worker processes must not race rotating refresh tokens.
async function locked<T>(workspaceId: string, run: () => Promise<T>): Promise<T> {
  assertLocalChatgpt(); await mkdir(directory(), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(`${file(workspaceId)}.lock`, "wx", 0o600); }
  catch { throw new ProviderError("unavailable", "The local ChatGPT connection is busy. Retry shortly; after a crashed process, remove its .lock file while the app and worker are stopped."); }
  try { return await run(); } finally { await handle.close(); await rm(`${file(workspaceId)}.lock`, { force: true }); }
}
async function discovery() {
  const response = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new ProviderError("unavailable", "OpenAI authentication discovery failed.");
  const value = await response.json() as { issuer: string; jwks_uri: string; revocation_endpoint: string };
  if (value.issuer !== ISSUER || new URL(value.jwks_uri).origin !== ISSUER || new URL(value.revocation_endpoint).origin !== ISSUER) throw new ProviderError("auth", "Unexpected OpenAI authentication metadata.");
  return value;
}
async function exchange(parameters: Record<string, string>) {
  const response = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...parameters, resource: RESOURCE }), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new ProviderError(response.status >= 500 ? "unavailable" : "auth", "ChatGPT authorization failed. Reconnect in Integrations.", response.status);
  return await response.json() as { access_token: string; refresh_token: string; id_token?: string; expires_in: number; scope: string; token_type: string };
}
function validateTokens(tokens: Awaited<ReturnType<typeof exchange>>) {
  if (!tokens.access_token || !tokens.refresh_token || tokens.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || !["chatgpt.tokens.use.direct", "resource.invoke"].every(scope => tokens.scope?.split(" ").includes(scope))) throw new ProviderError("auth", "ChatGPT plan permission was not granted. Enable plan use during consent.");
}
export async function chatgptLocalStatus(workspaceId: string) {
  if (!localChatgptEnabled()) return null;
  const store = await load(workspaceId), account = store.active ? store.accounts[store.active] : undefined;
  return { connected: !!account?.refreshToken, account: account?.email || account?.subject || null, models: account?.refreshToken ? account.models : [], selected: store.active, accounts: Object.values(store.accounts).map(a => ({ clientId: a.clientId, label: `${a.email || a.subject} · ${a.clientId.slice(-8)}` })) };
}
export async function beginChatgptSignIn(workspaceId: string, userId: string, origin: string, different = false, selected?: string) {
  assertLocalChatgpt(origin);
  return locked(workspaceId, async () => {
    const store = await load(workspaceId); await save(workspaceId, store); // Persist host before first authorization.
    if (selected && !store.accounts[selected]) throw new ProviderError("auth", "Select a saved ChatGPT account.");
    const account = !different && (selected || store.active) ? store.accounts[(selected || store.active)!] : undefined;
    const state = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    for (const [key, pending] of attempts) if (pending.expiresAt < Date.now() || (pending.workspaceId === workspaceId && pending.userId === userId)) attempts.delete(key);
    const redirectUri = `${new URL(origin).origin}/auth/callback`;
    attempts.set(state, { workspaceId, userId, state, nonce, verifier, redirectUri, expiresAt: Date.now() + 600_000, clientId: account?.clientId, subject: account?.subject });
    const query = new URLSearchParams({ client_id: account?.clientId ?? "dynamic_agent_client", ext_agent_host_id: store.hostId, response_type: "code", redirect_uri: redirectUri, scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct", resource: RESOURCE, state, nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
    if (!account) query.set("agent_name_hint", "MachinArc");
    return { state, url: `${ISSUER}/api/accounts/authorize?${query}` };
  });
}
export async function completeChatgptSignIn(url: URL, cookieState: string | undefined, workspaceId: string, userId: string) {
  assertLocalChatgpt(url.origin);
  const state = url.searchParams.get("state"), pending = state ? attempts.get(state) : undefined;
  if (!pending || !cookieState || state !== cookieState || pending.workspaceId !== workspaceId || pending.userId !== userId || pending.expiresAt < Date.now() || url.origin + url.pathname !== pending.redirectUri) throw new ProviderError("auth", "ChatGPT sign-in expired or did not match this session. Start again.");
  attempts.delete(pending.state); // Single use, including denied consent.
  if (url.searchParams.has("error")) throw new ProviderError("auth", "ChatGPT consent was declined. The existing connection was preserved.");
  const clientId = url.searchParams.get("client_id") ?? pending.clientId, code = url.searchParams.get("code");
  if (!code || !clientId || clientId === "dynamic_agent_client" || (pending.clientId && clientId !== pending.clientId)) throw new ProviderError("auth", "ChatGPT did not return the expected registered client.");
  return locked(workspaceId, async () => {
    const tokens = await exchange({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri }); validateTokens(tokens);
    if (!tokens.id_token) throw new ProviderError("auth", "ChatGPT did not return an identity token.");
    const metadata = await discovery();
    const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(metadata.jwks_uri)), { issuer: ISSUER, audience: clientId, requiredClaims: ["sub", "exp", "iat", "nonce"], clockTolerance: 5 });
    if (payload.nonce !== pending.nonce || !payload.sub || (pending.subject && payload.sub !== pending.subject)) throw new ProviderError("auth", "ChatGPT identity did not match the sign-in attempt.");
    const modelsResponse = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(20_000) });
    if (!modelsResponse.ok) throw new ProviderError("auth", "Could not load models for this ChatGPT account.");
    const catalog = await modelsResponse.json() as { models?: { visibility: string; slug: string; display_name: string }[] };
    const models: ModelDef[] = (catalog.models ?? []).filter(m => m.visibility === "list" && typeof m.slug === "string" && typeof m.display_name === "string").map(m => ({ provider: "chatgpt", id: m.slug, name: m.display_name, capabilities: ["tools"], contextTokens: 0, speed: "balanced", inputPer1M: null, outputPer1M: null, enabled: true }));
    if (!models.length) throw new ProviderError("invalid_model", "This ChatGPT account returned no selectable models.");
    const store = await load(workspaceId);
    if (store.accounts[clientId] && store.accounts[clientId].subject !== payload.sub) throw new ProviderError("auth", "Registered ChatGPT account identity changed.");
    store.active = clientId;
    store.accounts[clientId] = { clientId, subject: payload.sub, email: typeof payload.email === "string" ? payload.email : "", accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token, expiresAt: Date.now() + tokens.expires_in * 1000, scopes: tokens.scope.split(" "), models };
    await save(workspaceId, store);
  });
}
export async function chatgptAccess(workspaceId: string) {
  return locked(workspaceId, async () => {
    const store = await load(workspaceId), account = store.active ? store.accounts[store.active] : undefined;
    if (!account?.refreshToken || !account.accessToken) throw new ProviderError("auth", "Connect ChatGPT for this local workspace in Integrations.");
    if (account.expiresAt < Date.now() + 60_000) {
      const tokens = await exchange({ grant_type: "refresh_token", client_id: account.clientId, refresh_token: account.refreshToken }); validateTokens(tokens);
      Object.assign(account, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, scopes: tokens.scope.split(" "), ...(tokens.id_token ? { idToken: tokens.id_token } : {}) });
      await save(workspaceId, store);
    }
    return { token: account.accessToken!, models: account.models };
  });
}
export async function disconnectChatgpt(workspaceId: string) {
  return locked(workspaceId, async () => {
    const store = await load(workspaceId), account = store.active ? store.accounts[store.active] : undefined;
    let revoked = false;
    try {
      if (account?.refreshToken) { const metadata = await discovery(); const response = await fetch(metadata.revocation_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: account.refreshToken, token_type_hint: "refresh_token", client_id: account.clientId }), signal: AbortSignal.timeout(15_000) }); revoked = response.status === 200; }
      else revoked = true;
    } catch { /* Local disconnect still removes credentials; UI reports unconfirmed remote revocation. */ }
    if (account) { delete account.accessToken; delete account.refreshToken; delete account.idToken; account.expiresAt = 0; }
    for (const [state, pending] of attempts) if (pending.workspaceId === workspaceId) attempts.delete(state);
    await save(workspaceId, store); return revoked;
  });
}
