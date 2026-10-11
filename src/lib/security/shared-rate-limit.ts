import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sharedRateLimits } from "@/db/schema";

export const rateLimitKeyHash = (key: string) => createHash("sha256").update(key).digest("hex");

/** Database-clock sliding windows, serialized across processes by a transaction advisory lock. */
export async function sharedRateLimit(key: string, limit: { max: number; windowMs: number }, database: typeof db = db): Promise<{ ok: boolean; retryAfterMs: number }> {
  if (!Number.isInteger(limit.max) || limit.max < 1 || !Number.isSafeInteger(limit.windowMs) || limit.windowMs < 1) throw new Error("Invalid rate limit.");
  const keyHash = rateLimitKeyHash(key);
  const result = await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`shared-rate-limit:${keyHash}`}, 0))`);
    const clock = await tx.execute<{ now: string }>(sql`select clock_timestamp() as now`);
    const now = new Date(clock.rows[0].now);
    const [row] = await tx.select().from(sharedRateLimits).where(eq(sharedRateLimits.keyHash, keyHash));
    const hits = (row?.hits ?? []).filter((hit) => now.getTime() - hit.getTime() < limit.windowMs);
    if (hits.length >= limit.max) return { ok: false, retryAfterMs: limit.windowMs - (now.getTime() - hits[0].getTime()) };
    hits.push(now);
    const expiresAt = new Date(now.getTime() + limit.windowMs);
    await tx.insert(sharedRateLimits).values({ keyHash, hits, expiresAt }).onConflictDoUpdate({ target: sharedRateLimits.keyHash, set: { hits, expiresAt } });
    return { ok: true, retryAfterMs: 0 };
  });
  return result;
}

/** Worker maintenance; bounded row locks skip buckets another process is maintaining. */
export async function pruneSharedRateLimits(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid rate-limit cleanup batch.");
  const deleted = await db.execute(sql`delete from shared_rate_limits where expires_at <= clock_timestamp() and key_hash in (
    select key_hash from shared_rate_limits where expires_at <= clock_timestamp() order by expires_at limit ${limit} for update skip locked
  ) returning key_hash`);
  return deleted.rows.length;
}
