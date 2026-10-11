// Run: npx tsx --conditions=react-server --test tests/auth-security.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/security/password";

test("passwords round trip and reject incorrect and malformed hashes", async () => {
  const stored = await hashPassword("correct password");
  assert.equal(await verifyPassword("correct password", stored), true);
  assert.equal(await verifyPassword("incorrect password", stored), false);
  assert.equal(await verifyPassword("correct password", "broken"), false);
  assert.notEqual(stored, await hashPassword("correct password"));
});

test("login attempts are limited independently by account and address", () => {
  const account = `test:login:account:${Date.now()}`;
  const address = `test:login:ip:${Date.now()}`;
  for (let i = 0; i < LIMITS.loginPerAccount.max; i++) assert.equal(rateLimit(account, LIMITS.loginPerAccount).ok, true);
  const blocked = rateLimit(account, LIMITS.loginPerAccount);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 900_000);
  assert.equal(rateLimit(address, LIMITS.loginPerIp).ok, true);
  assert.equal(rateLimit(`${account}:other`, LIMITS.loginPerAccount).ok, true);
});

test("anonymous demo creation has an hourly address limit", () => {
  const address = `test:demo:${Date.now()}`;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(address, LIMITS.demoPerIp).ok, true);
  assert.equal(rateLimit(address, LIMITS.demoPerIp).ok, false);
});

test("limiter cleanup retains long-lived login buckets", () => {
  const now = Date.now;
  let clock = now();
  Date.now = () => clock;
  try {
    const account = `test:long-window:${clock}`;
    for (let i = 0; i < 5; i++) rateLimit(account, LIMITS.loginPerAccount);
    clock += 6 * 60_000;
    for (let i = 0; i < 5001; i++) rateLimit(`test:cleanup:${clock}:${i}`, LIMITS.runTaskPerWorkspace);
    assert.equal(rateLimit(account, LIMITS.loginPerAccount).ok, false);
    clock += 10 * 60_000;
    assert.equal(rateLimit(account, LIMITS.loginPerAccount).ok, true);
  } finally {
    Date.now = now;
  }
});
