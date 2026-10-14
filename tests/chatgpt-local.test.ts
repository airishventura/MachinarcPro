import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { beginChatgptSignIn, completeChatgptSignIn, chatgptLocalStatus, chatgptAccess, disconnectChatgpt, assertLocalChatgpt, localChatgptRequestUrl } from "../src/lib/integrations/chatgpt-local";
import { ChatgptProvider, chatgptRequest, completedChatgptResponse } from "../src/lib/ai/chatgpt-provider";
import { ProviderError } from "../src/lib/ai/types";

test("local ChatGPT authorization, isolation, refresh and disconnect", async t => {
  const keys = ["MARC_CHATGPT_LOCAL", "MARC_CHATGPT_LOCAL_DIR", "MARC_ENCRYPTION_KEY", "NODE_ENV", "VERCEL", "DATABASE_URL"];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const directory = await mkdtemp(join(tmpdir(), "marc-chatgpt-"));
  Object.assign(process.env, { MARC_CHATGPT_LOCAL: "1", MARC_CHATGPT_LOCAL_DIR: directory, MARC_ENCRYPTION_KEY: "test-only-local-encryption-key-123456789", NODE_ENV: "test", DATABASE_URL: "postgresql://127.0.0.1/machinarc_local" }); delete process.env.VERCEL;
  const workspace = "00000000-0000-0000-0000-000000000001", other = "00000000-0000-0000-0000-000000000002", origin = "http://127.0.0.1:3016";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "fixture", alg: "RS256", use: "sig" };
  let nonce = "", refreshes = 0, revoke = true, granted = true, tamper = false, oversizedBatch = false, issuer = "https://auth.openai.com", audience = "oaiapp_fixture", expiration = "1h";
  const fakeFetch = t.mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("openid-configuration")) return Response.json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/jwks", revocation_endpoint: "https://auth.openai.com/revoke" });
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/models")) return Response.json({ models: [{ visibility: "list", slug: "fixture-model", display_name: "Fixture model" }, { visibility: "hide", slug: "hidden", display_name: "Hidden" }] });
    if (url.endsWith("/responses")) {
      assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer fixture-access");
      const body = JSON.parse(String(options?.body)); assert.equal(body.store, false); assert.equal(body.stream, true);
      if (oversizedBatch) return stream([{ type: "response.completed", response: { status: "completed", output: Array.from({ length: 9 }, (_, i) => ({ type: "function_call", call_id: `call${i}`, name: "calculator", arguments: "{}" })) } }]);
      return stream([{ type: "response.completed", response: { status: "completed", model: "fixture-model", output: [{ type: "reasoning", id: "reason1", encrypted_content: "opaque-fixture", summary: [{ text: "Do not persist this summary" }] }, { type: "function_call", call_id: "call1", namespace: "machinarc", name: "calculator", arguments: '{"expression":"1+1"}' }], usage: { input_tokens: 10, output_tokens: 5 } } }], true);
    }
    if (url.endsWith("/revoke")) { assert.equal(new URLSearchParams(String(options?.body)).get("client_id"), "oaiapp_fixture"); return new Response(null, { status: revoke ? 200 : 503 }); }
    assert.equal(url, "https://auth.openai.com/api/accounts/oauth/token");
    const body = new URLSearchParams(String(options?.body)); assert.equal(body.get("resource"), "https://api.openai.com/v1"); assert.equal(body.get("client_id"), "oaiapp_fixture");
    if (body.get("grant_type") === "refresh_token") { refreshes++; assert.equal(body.get("refresh_token"), "fixture-refresh"); assert.equal(body.has("scope"), false); }
    else { assert.equal(body.get("redirect_uri"), `${origin}/auth/callback`); assert(body.get("code_verifier")); }
    const idToken = await new SignJWT({ nonce, email: "fixture@example.invalid" }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).setSubject("fixture-subject").setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
    return Response.json({ access_token: "fixture-access", refresh_token: body.get("grant_type") === "refresh_token" ? "rotated-refresh" : "fixture-refresh", id_token: tamper ? idToken.slice(0, -5) + "AAAAA" : idToken, token_type: "Bearer", expires_in: body.get("grant_type") === "refresh_token" ? 3600 : 30, scope: granted ? "openid resource.invoke chatgpt.tokens.use.direct" : "openid" });
  });
  async function attempt() { const result = await beginChatgptSignIn(workspace, "operator", origin); nonce = new URL(result.url).searchParams.get("nonce")!; return { ...result, callback: new URL(`${origin}/auth/callback?code=fixture-code&client_id=oaiapp_fixture&state=${result.state}`) }; }
  try {
    await t.test("production, Vercel, nonlocal origins and production databases are rejected", () => {
      Object.assign(process.env, { NODE_ENV: "production" }); assert.throws(() => assertLocalChatgpt(), ProviderError); Object.assign(process.env, { NODE_ENV: "test" });
      process.env.VERCEL = "1"; assert.throws(() => assertLocalChatgpt(), ProviderError); delete process.env.VERCEL;
      process.env.DATABASE_URL = "postgresql://remote.example/postgres"; assert.throws(() => assertLocalChatgpt(), ProviderError); process.env.DATABASE_URL = "postgresql://127.0.0.1/machinarc_local";
      assert.throws(() => assertLocalChatgpt("https://machinarcpro.com"), ProviderError);
      assert.throws(() => assertLocalChatgpt("http://localhost:3016"), ProviderError);
      assert.equal(localChatgptRequestUrl(new Request("http://localhost:3016/auth/callback?state=fixture", { headers: { host: "127.0.0.1:3016" } })).toString(), "http://127.0.0.1:3016/auth/callback?state=fixture");
      assert.throws(() => localChatgptRequestUrl(new Request("http://localhost:3016/auth/callback", { headers: { host: "remote.invalid", "x-forwarded-host": "127.0.0.1:3016" } })), ProviderError);
    });
    await t.test("state, cookie and workspace binding reject forgery without network exchange", async () => {
      const a = await attempt(), calls = fakeFetch.mock.callCount();
      await assert.rejects(completeChatgptSignIn(a.callback, "wrong", workspace, "operator"), ProviderError);
      await assert.rejects(completeChatgptSignIn(a.callback, a.state, other, "operator"), ProviderError);
      await assert.rejects(completeChatgptSignIn(a.callback, a.state, workspace, "different-operator"), ProviderError);
      assert.equal(fakeFetch.mock.callCount(), calls);
    });
    await t.test("signature, issuer, audience, nonce and expiration are validated", async () => {
      for (const invalid of ["signature", "nonce", "issuer", "audience", "expiry"]) {
        const a = await attempt(); if (invalid === "signature") tamper = true; if (invalid === "nonce") nonce = "wrong"; if (invalid === "issuer") issuer = "https://wrong.invalid"; if (invalid === "audience") audience = "wrong-client"; if (invalid === "expiry") expiration = "-1h";
        await assert.rejects(completeChatgptSignIn(a.callback, a.state, workspace, "operator"));
        tamper = false; issuer = "https://auth.openai.com"; audience = "oaiapp_fixture"; expiration = "1h";
      }
    });
    await t.test("identity without plan grant cannot enable inference", async () => {
      const a = await attempt(); granted = false; await assert.rejects(completeChatgptSignIn(a.callback, a.state, workspace, "operator"), ProviderError); granted = true;
      assert.equal((await chatgptLocalStatus(workspace))?.connected, false);
    });
    await t.test("PKCE registration stores encrypted credentials and prevents callback replay", async () => {
      const a = await attempt(), authorization = new URL(a.url); assert.equal(authorization.searchParams.get("client_id"), "dynamic_agent_client"); assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
      await completeChatgptSignIn(a.callback, a.state, workspace, "operator");
      assert.equal((await chatgptLocalStatus(workspace))?.models.length, 1);
      const stored = await readFile(join(directory, `${workspace}.json`), "utf8"); assert(!stored.includes("fixture-access")); assert(!stored.includes("fixture-refresh"));
      await assert.rejects(completeChatgptSignIn(a.callback, a.state, workspace, "operator"), ProviderError);
      assert.equal((await chatgptLocalStatus(other))?.connected, false);
    });
    await t.test("refresh rotates once and concurrent processes cannot race", async () => {
      const results = await Promise.allSettled([chatgptAccess(workspace), chatgptAccess(workspace)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(refreshes, 1);
      assert.equal((await chatgptAccess(workspace)).token, "fixture-access"); assert.equal(refreshes, 1);
    });
    await t.test("reauthorization retains client/host and declined consent preserves credentials", async () => {
      const a = await attempt(); assert.equal(new URL(a.url).searchParams.get("client_id"), "oaiapp_fixture"); assert.equal(new URL(a.url).searchParams.has("agent_name_hint"), false);
      a.callback.searchParams.set("error", "access_denied"); await assert.rejects(completeChatgptSignIn(a.callback, a.state, workspace, "operator"), ProviderError);
      assert.equal((await chatgptLocalStatus(workspace))?.connected, true);
    });
    await t.test("provider maps completed tools and preserves opaque state for approval/resume", async () => {
      const result = await new ChatgptProvider(workspace).generate({ model: "fixture-model", messages: [{ role: "user", content: "Calculate" }], tools: [{ name: "calculator", description: "Calculate", parameters: { type: "object" } }] });
      assert.equal(result.toolCalls[0].args.expression, "1+1"); assert.equal(result.usage.inputTokens, 10); assert.equal(result.providerMetadata.provider, "chatgpt"); assert.equal(new ChatgptProvider(workspace).calculateEstimatedCost(), null);
      assert.deepEqual(result.providerItems?.[0].summary, []);
      const next = chatgptRequest({ model: "fixture-model", messages: [{ role: "assistant", content: "", toolCalls: result.toolCalls, providerItems: result.providerItems }, { role: "tool", toolCallId: "call1", toolName: "calculator", content: "2" }] });
      assert.equal(next.input[0].encrypted_content, "opaque-fixture"); assert.equal(next.input[1].namespace, "machinarc"); assert.equal(next.input[2].call_id, "call1");
      await assert.rejects(new ChatgptProvider(workspace).generate({ model: "not-in-catalog", messages: [] }), (e: unknown) => e instanceof ProviderError && e.kind === "invalid_model");
      oversizedBatch = true;
      await assert.rejects(new ChatgptProvider(workspace).generate({ model: "fixture-model", messages: [] }), (e: unknown) => e instanceof ProviderError && e.kind === "bad_request");
      oversizedBatch = false;
    });
    await t.test("disconnect clears tokens even when remote revocation is unconfirmed", async () => {
      revoke = false; assert.equal(await disconnectChatgpt(workspace), false); assert.equal((await chatgptLocalStatus(workspace))?.connected, false); await assert.rejects(chatgptAccess(workspace), ProviderError);
      assert.equal((await readdir(directory)).some(n => n.endsWith(".lock") || n.endsWith(".tmp")), false);
    });
  } finally {
    fakeFetch.mock.restore(); for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
    await rm(directory, { recursive: true, force: true });
  }
});

test("ChatGPT requests use stateless streaming Responses, namespaced tools and durable tool history", () => {
  const body = chatgptRequest({ model: "fixture-model", maxOutputTokens: 100, temperature: 0.4, messages: [{ role: "system", content: "Rules" }, { role: "user", content: "Calculate" }, { role: "assistant", content: "", toolCalls: [{ id: "call1", name: "calculator", args: { expression: "1+1" } }] }, { role: "tool", content: "2", toolCallId: "call1", toolName: "calculator" }], tools: [{ name: "calculator", description: "Calculate", parameters: { type: "object" } }] });
  assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.instructions, "Rules"); assert.equal(body.tools?.[0].type, "namespace"); assert.equal(body.input[1].namespace, "machinarc"); assert.equal(body.input[2].call_id, "call1");
  assert(!("temperature" in body)); assert(!("max_output_tokens" in body)); assert(!("previous_response_id" in body));
});
function stream(events: unknown[], fragmented = false) {
  const content = events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""); const bytes = new TextEncoder().encode(content);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += fragmented ? 7 : bytes.length) controller.enqueue(bytes.slice(i, i + (fragmented ? 7 : bytes.length))); controller.close(); } }));
}
test("only a completed terminal event authorizes output and tool execution", async () => {
  const completed = { type: "response.completed", response: { status: "completed", output: [{ type: "function_call", call_id: "call1", name: "calculator", arguments: "{}" }] } };
  assert.equal((await completedChatgptResponse(stream([completed], true))).output?.length, 1);
  const thin = await completedChatgptResponse(stream([{ type: "response.output_item.done", output_index: 0, item: { type: "function_call", call_id: "thin-call", name: "calculator", arguments: "{}" } }, { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 11, output_tokens: 6 } } }], true));
  assert.equal(thin.output?.[0].call_id, "thin-call");
  assert.deepEqual(thin.usage, { input_tokens: 11, output_tokens: 6 });
  await assert.rejects(completedChatgptResponse(stream([{ type: "response.output_item.done", output_index: 0, item: { type: "function_call", call_id: "unfinished", name: "calculator", arguments: "{}" } }])), ProviderError);
  await assert.rejects(completedChatgptResponse(stream([{ type: "response.output_text.delta", delta: "partial" }])), ProviderError);
  await assert.rejects(completedChatgptResponse(stream([{ type: "response.incomplete" }])), ProviderError);
  await assert.rejects(completedChatgptResponse(stream([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }])), (error: unknown) => error instanceof ProviderError && error.kind === "quota");
});
