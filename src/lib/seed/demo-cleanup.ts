import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, workspaces } from "@/db/schema";
import { DEMO_RETENTION_MS, VISITOR_DEMO_EMAIL_PATTERN } from "./demo-retention";
import { pruneSharedRateLimits } from "@/lib/security/shared-rate-limit";

/** Delete only old, sole-owner visitor demos; workspace/profile locks protect concurrent membership changes. */
export async function cleanupExpiredVisitorDemos(options: { limit?: number; now?: Date; workspaceIds?: string[] } = {}) {
  const limit = Math.max(1, Math.min(25, Math.floor(options.limit ?? 10)));
  const cutoff = new Date((options.now ?? new Date()).getTime() - DEMO_RETENTION_MS).toISOString();
  const scope = options.workspaceIds ? sql`and w.id in (${sql.join(options.workspaceIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  if (options.workspaceIds?.length === 0) return 0;
  const eligible = sql`
    w.policy @> '{"demo":true}'::jsonb and w.created_at <= ${cutoff}::timestamp
    and u.created_at <= ${cutoff}::timestamp and u.email ~ ${VISITOR_DEMO_EMAIL_PATTERN}
    and u.password_hash is null and u.google_id is null and owner.role = 'owner'
    and not exists (select 1 from workspace_members other where other.workspace_id = w.id and other.user_id <> u.id)
    and not exists (select 1 from workspace_members other where other.user_id = u.id and other.workspace_id <> w.id)
    and not exists (select 1 from machines m where m.workspace_id = w.id and m.status in ('initializing','running'))
    and not exists (select 1 from machine_tasks t where t.workspace_id = w.id and t.status in ('queued','initializing','running','waiting_tool','waiting_approval'))
    and not exists (select 1 from machine_runs r join machines m on m.id = r.machine_id where m.workspace_id = w.id and r.status in ('queued','initializing','running','waiting_tool','waiting_approval'))
    and not exists (select 1 from arc_runs r where r.workspace_id = w.id and r.status in ('queued','running','waiting_approval','waiting_delay'))
    and not exists (select 1 from jobs j where j.workspace_id = w.id and j.status in ('queued','running'))
    and not exists (select 1 from integration_credentials c where c.workspace_id = w.id)
  `;
  return db.transaction(async (tx) => {
    // Keep independent serverless invocations from deleting the same batch concurrently.
    const lock = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(1835102819, 7) as acquired`);
    if (!lock.rows[0]?.acquired) return 0;
    const candidates = await tx.execute<{ workspace_id: string; user_id: string }>(sql`
      select w.id as workspace_id, u.id as user_id from workspaces w
      join workspace_members owner on owner.workspace_id = w.id join profiles u on u.id = owner.user_id
      where ${eligible} ${scope} order by w.created_at, w.id limit ${limit}
      for update of w, u, owner skip locked
    `);
    let removed = 0;
    for (const candidate of candidates.rows) {
      // Skip an in-flight Machine mutation instead of waiting behind a runtime lock.
      const locked = await tx.execute<{ id: string }>(sql`select id from machines where workspace_id = ${candidate.workspace_id} for update skip locked`);
      const count = await tx.execute<{ count: number }>(sql`select count(*)::int as count from machines where workspace_id = ${candidate.workspace_id}`);
      if (locked.rows.length !== count.rows[0].count) continue;
      // Recheck on a fresh READ COMMITTED snapshot after obtaining the parent locks.
      const check = await tx.execute(sql`
        select w.id from workspaces w join workspace_members owner on owner.workspace_id = w.id
        join profiles u on u.id = owner.user_id where w.id = ${candidate.workspace_id} and u.id = ${candidate.user_id} and ${eligible}
      `);
      if (!check.rows.length) continue;
      await tx.delete(workspaces).where(eq(workspaces.id, candidate.workspace_id));
      await tx.delete(users).where(eq(users.id, candidate.user_id)); // sessions cascade with the visitor identity
      removed++;
    }
    return removed;
  });
}

const state = globalThis as typeof globalThis & { __marcDemoCleanupAt?: number; __marcDemoCleanup?: Promise<number> };

/** Prune bounded limiter buckets each minute; warm workers scan demos at most hourly. */
export async function maybeCleanupVisitorDemos() {
  await pruneSharedRateLimits(1000);
  if (state.__marcDemoCleanup) return state.__marcDemoCleanup;
  const now = Date.now();
  if (now - (state.__marcDemoCleanupAt ?? 0) < 60 * 60 * 1000) return Promise.resolve(0);
  state.__marcDemoCleanupAt = now;
  state.__marcDemoCleanup = cleanupExpiredVisitorDemos().catch((error) => {
    state.__marcDemoCleanupAt = 0;
    throw error;
  }).finally(() => { state.__marcDemoCleanup = undefined; });
  return state.__marcDemoCleanup;
}
