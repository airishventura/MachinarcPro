// Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs --conditions=react-server --test tests/shared-rate-limit.test.ts
import "./helpers/setup-test-database";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { sharedRateLimits } from "@/db/schema";
import { pruneSharedRateLimits, rateLimitKeyHash, sharedRateLimit } from "@/lib/security/shared-rate-limit";

const secondPool = new Pool(pool.options);
const secondDatabase = drizzle(secondPool);
const keys: string[] = [];
const key = (name: string) => { const value = `test:${name}:${randomUUID()}`; keys.push(rateLimitKeyHash(value)); return value; };
let secondPoolClosed = false;
after(async () => {
  try { if (keys.length) await db.delete(sharedRateLimits).where(inArray(sharedRateLimits.keyHash, keys)); }
  finally { if (!secondPoolClosed) await secondPool.end(); await pool.end(); }
});

test("independent database clients atomically enforce one shared sliding window", async () => {
  const bucket = key("concurrent");
  const limit = { max: 5, windowMs: 60_000 };
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => sharedRateLimit(bucket, limit, i % 2 ? db : secondDatabase)));
  assert.equal(results.filter((result) => result.ok).length, 5);
  assert.equal(results.filter((result) => !result.ok).length, 3);
  assert.ok(results.filter((result) => !result.ok).every((result) => result.retryAfterMs > 0 && result.retryAfterMs <= limit.windowMs));
  const [row] = await db.select().from(sharedRateLimits).where(eq(sharedRateLimits.keyHash, rateLimitKeyHash(bucket)));
  assert.equal(row.hits.length, 5);
  assert.match(row.keyHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(row).includes(bucket), false);
  assert.equal((await sharedRateLimit(bucket, limit, secondDatabase)).ok, false);
});

test("expired hits release capacity while recent hits and independent namespaces are preserved", async () => {
  const bucket = key("expiry");
  const [clock] = (await pool.query<{ now: Date }>("select clock_timestamp() as now")).rows;
  const old = new Date(clock.now.getTime() - 120_000);
  const recent = new Date(clock.now.getTime() - 10_000);
  await db.insert(sharedRateLimits).values({ keyHash: rateLimitKeyHash(bucket), hits: [old, recent], expiresAt: new Date(clock.now.getTime() + 50_000) });
  const limit = { max: 2, windowMs: 60_000 };
  assert.equal((await sharedRateLimit(bucket, limit, secondDatabase)).ok, true);
  const blocked = await sharedRateLimit(bucket, limit);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 50_000);
  assert.equal((await sharedRateLimit(key("other-namespace"), limit)).ok, true);
});

test("bounded maintenance deletes expired buckets and preserves live buckets", async () => {
  const expired = rateLimitKeyHash(key("expired-cleanup"));
  const live = rateLimitKeyHash(key("live-cleanup"));
  await db.insert(sharedRateLimits).values([
    { keyHash: expired, hits: [new Date(0)], expiresAt: new Date(0) },
    { keyHash: live, hits: [new Date()], expiresAt: new Date(Date.now() + 60_000) },
  ]);
  assert.equal(await pruneSharedRateLimits(1), 1);
  assert.equal((await db.select().from(sharedRateLimits).where(eq(sharedRateLimits.keyHash, expired))).length, 0);
  assert.equal((await db.select().from(sharedRateLimits).where(eq(sharedRateLimits.keyHash, live))).length, 1);
});

test("database failures reject requests rather than falling back to local allowance", async () => {
  await secondPool.end();
  secondPoolClosed = true;
  const bucket = key("failed-database");
  await assert.rejects(sharedRateLimit(bucket, { max: 3, windowMs: 60_000 }, secondDatabase));
  assert.equal((await db.select().from(sharedRateLimits).where(eq(sharedRateLimits.keyHash, rateLimitKeyHash(bucket)))).length, 0);
});
