import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { jobs } from "@/db/schema";
import type { PoolClient } from "pg";

export type JobKind = "machine.deploy" | "machine.execute" | "arc.drive" | "trigger.fire";
export type Job = typeof jobs.$inferSelect;
export const LEASE_MS = 5 * 60_000;

/** Insert using the caller's transaction; wake workers only after that transaction commits. */
export async function enqueueInTransaction(client: PoolClient, kind: JobKind, payload: Record<string, unknown>, o: { workspaceId: string; dedupeKey: string }) {
  await client.query(`insert into jobs (kind, payload, workspace_id, dedupe_key) values ($1, $2::jsonb, $3, $4) on conflict do nothing`, [kind, JSON.stringify(payload), o.workspaceId, o.dedupeKey]);
}

/**
 * Enqueue a job. `dedupeKey` guarantees at most one queued/running job per key
 * (e.g. "machine:<runId>") — duplicate enqueues are no-ops, which makes every
 * caller idempotent and prevents duplicate execution.
 */
export async function enqueue(kind: JobKind, payload: Record<string, unknown>, o: { workspaceId?: string | null; runAt?: Date; dedupeKey?: string; maxAttempts?: number; priority?: number } = {}) {
  const [row] = await db.insert(jobs).values({ kind, payload, workspaceId: o.workspaceId ?? null, runAt: o.runAt ?? new Date(), dedupeKey: o.dedupeKey, maxAttempts: o.maxAttempts ?? 3, priority: o.priority ?? 5 })
    .onConflictDoNothing().returning({ id: jobs.id });
  notifyWorkers();
  return row?.id ?? null;
}

/** Atomically claims due jobs (queued, or running with an expired lease = crashed worker). */
export async function claim(workerId: string, limit: number, workspaceId?: string): Promise<Job[]> {
  const { rows } = await pool.query(
    `update jobs set status = 'running', locked_by = $1, locked_until = now() + ($2 || ' milliseconds')::interval,
            attempts = attempts + 1, started_at = coalesce(started_at, now())
     where id in (
       select id from jobs
       where ((status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now()))
         and ($4::uuid is null or workspace_id = $4)
       order by priority asc, run_at asc
       limit $3 for update skip locked)
     returning id`, [workerId, String(LEASE_MS), limit, workspaceId ?? null]);
  if (!rows.length) return [];
  return db.select().from(jobs).where(inArray(jobs.id, rows.map((r: { id: string }) => r.id)));
}

export async function extendLease(jobId: string, workerId: string) {
  await db.update(jobs).set({ lockedUntil: new Date(Date.now() + LEASE_MS) }).where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId)));
}
export async function completeJob(job: Job) {
  await db.update(jobs).set({ status: "completed", completedAt: new Date(), lockedBy: null, lockedUntil: null }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.lockedBy ?? ""), eq(jobs.attempts, job.attempts)));
}
/** Retries with exponential backoff (10s, 40s, 160s…) until maxAttempts, then dead-letters. */
export async function failJob(job: Job, error: string) {
  const dead = job.attempts >= job.maxAttempts;
  await db.update(jobs).set({
    status: dead ? "dead" : "queued", lastError: error.slice(0, 1000), lockedBy: null, lockedUntil: null,
    runAt: dead ? job.runAt : new Date(Date.now() + 10_000 * 4 ** (job.attempts - 1)), completedAt: dead ? new Date() : null,
  }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.lockedBy ?? ""), eq(jobs.attempts, job.attempts)));
  return dead;
}

export async function queueStats(workspaceId?: string) {
  const where = workspaceId ? sql`where workspace_id = ${workspaceId}` : sql``;
  const r = await db.execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from jobs ${where} group by status`);
  return Object.fromEntries((r.rows as { status: string; n: number }[]).map((x) => [x.status, x.n])) as Record<string, number>;
}

// In-process wake-up so freshly enqueued jobs start immediately instead of waiting for the next poll.
const g = globalThis as typeof globalThis & { __marcWake?: Set<() => void> };
export const wakeListeners = (g.__marcWake ??= new Set());
export function notifyWorkers() { for (const f of wakeListeners) { try { f(); } catch { /* ignore */ } } }
