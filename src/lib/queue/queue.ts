import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { jobs } from "@/db/schema";
import type { PoolClient } from "pg";
import { obs, redactString } from "@/lib/security/redact";

export type JobKind = "machine.deploy" | "machine.execute" | "arc.drive" | "trigger.fire";
export type Job = typeof jobs.$inferSelect;
export function jobLeaseMs() {
  const seconds = Number(process.env.MACHINARC_JOB_LEASE_SECONDS ?? 120);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) throw new Error("Invalid MACHINARC_JOB_LEASE_SECONDS (30–3600).");
  return seconds * 1000;
}
/** Compatibility for the existing interruption acceptance script. */
export const LEASE_MS = jobLeaseMs();

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
  if (row) obs("job.queued", { jobId: row.id, kind, workspaceId: o.workspaceId, runId: payload.runId, machineId: payload.machineId });
  return row?.id ?? null;
}

/** Atomically claims due jobs (queued, or running with an expired lease = crashed worker). */
export async function claim(workerId: string, limit: number, workspaceId?: string): Promise<Job[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid queue claim limit.");
  // Crashes consume attempts too. Exhausted jobs must not receive a fresh retry budget.
  await pool.query(`update jobs set status = 'dead', completed_at = (now() at time zone 'UTC'), locked_by = null, locked_until = null,
    last_error = 'Worker retry limit exhausted after interruption.'
    where attempts >= max_attempts and ((status = 'running' and locked_until < (now() at time zone 'UTC')) or status = 'queued')
      and ($1::uuid is null or workspace_id = $1)`, [workspaceId ?? null]);
  const { rows } = await pool.query(
    `update jobs set status = 'running', locked_by = $1, locked_until = (now() at time zone 'UTC') + ($2 || ' milliseconds')::interval,
            attempts = attempts + 1, started_at = coalesce(started_at, (now() at time zone 'UTC'))
     where id in (
       select id from jobs
       where ((status = 'queued' and run_at <= (now() at time zone 'UTC')) or (status = 'running' and locked_until < (now() at time zone 'UTC')))
         and attempts < max_attempts and ($4::uuid is null or workspace_id = $4)
       order by priority asc, run_at asc
       limit $3 for update skip locked)
     returning id, attempts`, [workerId, String(jobLeaseMs()), limit, workspaceId ?? null]);
  if (!rows.length) return [];
  const claimed = await db.select().from(jobs).where(and(inArray(jobs.id, rows.map((r: { id: string }) => r.id)), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)));
  return claimed.filter(job => rows.some(row => row.id === job.id && row.attempts === job.attempts));
}

export async function extendLease(jobId: string, workerId: string, attempt: number) {
  const rows = await db.update(jobs).set({ lockedUntil: sql`(now() at time zone 'UTC') + (${String(jobLeaseMs())} || ' milliseconds')::interval` })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId), eq(jobs.attempts, attempt), sql`${jobs.lockedUntil} > (now() at time zone 'UTC')`)).returning({ id: jobs.id });
  return rows.length === 1;
}
export async function completeJob(job: Job) {
  const updated = await db.update(jobs).set({ status: "completed", completedAt: new Date(), lockedBy: null, lockedUntil: null }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.lockedBy ?? ""), eq(jobs.attempts, job.attempts), sql`${jobs.lockedUntil} > (now() at time zone 'UTC')`)).returning({ id: jobs.id });
  return updated.length === 1;
}
/** A live runtime driver is contention, not a failed attempt. Wait for its lease before retrying. */
export async function deferJob(job: Job, runAt: Date) {
  await db.update(jobs).set({ status: "queued", runAt, attempts: Math.max(0, job.attempts - 1), lockedBy: null, lockedUntil: null })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.lockedBy ?? ""), eq(jobs.attempts, job.attempts), sql`${jobs.lockedUntil} > (now() at time zone 'UTC')`));
}
/** Retries with exponential backoff (10s, 40s, 160s…) until maxAttempts, then dead-letters. */
export async function failJob(job: Job, error: string) {
  const dead = job.attempts >= job.maxAttempts;
  await db.update(jobs).set({
    status: dead ? "dead" : "queued", lastError: redactString(error).slice(0, 1000), lockedBy: null, lockedUntil: null,
    runAt: dead ? job.runAt : new Date(Date.now() + 10_000 * 4 ** (job.attempts - 1)), completedAt: dead ? new Date() : null,
  }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.lockedBy ?? ""), eq(jobs.attempts, job.attempts), sql`${jobs.lockedUntil} > (now() at time zone 'UTC')`));
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
