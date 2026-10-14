import "server-only";
import os from "node:os";
import { and, eq, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { arcRuns, jobs, machineRuns, machines, workerHeartbeats } from "@/db/schema";
import { claim, completeJob, deferJob, enqueue, extendLease, failJob, jobLeaseMs, wakeListeners, type Job } from "@/lib/queue/queue";
import { fireTarget, tickSchedules } from "@/lib/automation/triggers";
import { errorSummary, obs } from "@/lib/security/redact";
import { startWorkerLoop } from "@/lib/queue/worker-loop";
import { maybeCleanupVisitorDemos } from "@/lib/seed/demo-cleanup";
import { jobContext } from "@/lib/runtime/job-context";

type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>;
class DriverBusy extends Error {
  constructor(readonly until: Date) { super("Run is held by another driver."); }
}

/** Job handlers. Every handler is idempotent: runtimes are lock-guarded and resume from persisted state. */
export const HANDLERS: Record<string, Handler> = {
  "machine.deploy": async (p, job) => {
    const { MachineRuntime } = await import("@/lib/runtime/machine-runtime");
    if (!job.workspaceId || p.workspaceId !== job.workspaceId) throw new Error("Job workspace mismatch.");
    const rt = await MachineRuntime.load(String(p.machineId), job.workspaceId);
    await rt.deploy();
  },
  "machine.execute": async (p, job) => {
    const [owned] = await db.select({ id: machineRuns.id }).from(machineRuns).innerJoin(machines, eq(machines.id, machineRuns.machineId))
      .where(and(eq(machineRuns.id, String(p.runId)), eq(machines.workspaceId, job.workspaceId ?? "")));
    if (!owned) throw new Error("Run not found in job workspace.");
    const { MachineRuntime } = await import("@/lib/runtime/machine-runtime");
    const result = await MachineRuntime.resume(String(p.runId));
    if (result?.status === "busy") {
      const [run] = await db.select({ status: machineRuns.status, lockUntil: machineRuns.lockUntil }).from(machineRuns).where(eq(machineRuns.id, String(p.runId)));
      if (run && (ORPHAN as readonly string[]).includes(run.status)) throw new DriverBusy(new Date(Math.max(Date.now() + 1000, run.lockUntil?.getTime() ?? 0) + 1000));
    }
  },
  "arc.drive": async (p, job) => {
    const [owned] = await db.select({ id: arcRuns.id }).from(arcRuns).where(and(eq(arcRuns.id, String(p.runId)), eq(arcRuns.workspaceId, job.workspaceId ?? "")));
    if (!owned) throw new Error("Arc run not found in job workspace.");
    const { ArcRuntime } = await import("@/lib/arcs/runtime");
    await ArcRuntime.drive(String(p.runId));
    const [run] = await db.select({ lockUntil: arcRuns.lockUntil }).from(arcRuns).where(eq(arcRuns.id, String(p.runId)));
    if (run?.lockUntil && run.lockUntil > new Date()) throw new DriverBusy(new Date(run.lockUntil.getTime() + 1000));
  },
  "trigger.fire": async (p, job) => {
    await fireTarget({ workspaceId: String(job.workspaceId), jobId: job.id, targetType: String(p.targetType), targetId: String(p.targetId), input: String(p.input ?? ""), source: p.source as "schedule", sourceId: p.sourceId ? String(p.sourceId) : null, depth: Number(p.depth ?? 0), overlap: p.overlap === "queue" ? "queue" : "skip" });
  },
};

const ORPHAN = ["queued", "initializing", "running", "waiting_tool"] as const;

/** Crash recovery: re-enqueue runs whose driver vanished (expired lock, no active job). */
export async function recoverOrphans(workspaceId?: string) {
  await settleExhaustedRuns(workspaceId);
  const activeJob = (key: ReturnType<typeof sql>) => db.select({ x: sql`1` }).from(jobs).where(and(sql`${jobs.dedupeKey} = ${key}`, inArray(jobs.status, ["queued", "running", "dead"])));
  const mr = await db.select({ id: machineRuns.id, ws: machines.workspaceId }).from(machineRuns).innerJoin(machines, eq(machines.id, machineRuns.machineId))
    .where(and(workspaceId ? eq(machines.workspaceId, workspaceId) : undefined, inArray(machineRuns.status, [...ORPHAN]), or(isNull(machineRuns.lockUntil), lt(machineRuns.lockUntil, new Date())), lt(machineRuns.createdAt, new Date(Date.now() - 15_000)), notExists(activeJob(sql`'machine:' || ${machineRuns.id}`)))).limit(50);
  for (const r of mr) await enqueue("machine.execute", { runId: r.id }, { workspaceId: r.ws, dedupeKey: `machine:${r.id}` });
  const ar = await db.select({ id: arcRuns.id, ws: arcRuns.workspaceId }).from(arcRuns)
    .where(and(workspaceId ? eq(arcRuns.workspaceId, workspaceId) : undefined,
      or(inArray(arcRuns.status, ["queued", "running"]), and(eq(arcRuns.status, "waiting_delay"), sql`exists (select 1 from arc_run_nodes n where n.arc_run_id = ${arcRuns.id} and n.status = 'waiting' and n.resume_at <= (now() at time zone 'UTC'))`)),
      or(isNull(arcRuns.lockUntil), lt(arcRuns.lockUntil, new Date())), lt(arcRuns.createdAt, new Date(Date.now() - 15_000)), notExists(activeJob(sql`'arc:' || ${arcRuns.id}`)), notExists(activeJob(sql`'arc-recover:' || ${arcRuns.id}`)))).limit(50);
  for (const r of ar) await enqueue("arc.drive", { runId: r.id }, { workspaceId: r.ws, dedupeKey: `arc:${r.id}` });
  return mr.length + ar.length;
}

/** Surface exhausted crash recovery in the existing dashboard, without rerunning side effects. */
export async function settleExhaustedRuns(workspaceId?: string) {
  const client = await pool.connect();
  const message = "Worker recovery exhausted its retry limit. Inspect the run before starting a new task.";
  try {
    await client.query("begin");
    const { rows } = await client.query(`update machine_runs r set status = 'failed', error = $1,
      error_kind = 'worker_retries_exhausted', ended_at = (now() at time zone 'UTC'), lock_owner = null, lock_until = null
      where r.id in (select r.id from machine_runs r join machines m on m.id = r.machine_id
        where r.status in ('queued','initializing','running','waiting_tool') and (r.lock_until is null or r.lock_until < (now() at time zone 'UTC'))
          and ($2::uuid is null or m.workspace_id = $2)
          and exists (select 1 from jobs j where j.dedupe_key = 'machine:' || r.id and j.status = 'dead' and j.workspace_id = m.workspace_id)
          and not exists (select 1 from jobs j where j.dedupe_key = 'machine:' || r.id and j.status in ('queued','running')) limit 50)
        and r.status in ('queued','initializing','running','waiting_tool') and (r.lock_until is null or r.lock_until < (now() at time zone 'UTC'))
      returning id, machine_id, task_id`, [message, workspaceId ?? null]);
    for (const run of rows) {
      await client.query("update machine_tasks set status = 'failed', output = $2, completed_at = (now() at time zone 'UTC') where id = $1", [run.task_id, message]);
      await client.query(`update machines m set status = case when status = 'paused' then 'paused'::machine_status else 'failed'::machine_status end, current_task = null
        where m.id = $1 and not exists (select 1 from machine_runs r where r.machine_id = m.id and r.status in ('queued','initializing','running','waiting_tool','waiting_approval'))`, [run.machine_id]);
    }
    await client.query(`update arc_runs r set status = 'failed', error_message = $1, completed_at = (now() at time zone 'UTC'), lock_owner = null, lock_until = null
      where r.id in (select r.id from arc_runs r where r.status in ('queued','running','waiting_delay') and (r.lock_until is null or r.lock_until < (now() at time zone 'UTC'))
        and ($2::uuid is null or r.workspace_id = $2)
        and exists (select 1 from jobs j where j.dedupe_key in ('arc:' || r.id, 'arc-recover:' || r.id) and j.status = 'dead' and j.workspace_id = r.workspace_id)
        and not exists (select 1 from jobs j where j.dedupe_key in ('arc:' || r.id, 'arc-recover:' || r.id) and j.status in ('queued','running')) limit 50)
        and r.status in ('queued','running','waiting_delay') and (r.lock_until is null or r.lock_until < (now() at time zone 'UTC'))`, [message, workspaceId ?? null]);
    await client.query("commit");
    if (rows.length) {
      const { ArcRuntime } = await import("@/lib/arcs/runtime");
      for (const run of rows) await ArcRuntime.onMachineRunFinished(run.id);
    }
    return rows.length;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function processJob(job: Job, workerId: string) {
  const ctrl = new AbortController();
  return jobContext.run({ jobId: job.id, workerId, attempt: job.attempts, runId: typeof job.payload.runId === "string" ? job.payload.runId : undefined, machineId: typeof job.payload.machineId === "string" ? job.payload.machineId : undefined, signal: ctrl.signal }, async () => {
  const h = HANDLERS[job.kind];
  let renewing = false;
  const lease = setInterval(() => {
    if (renewing || ctrl.signal.aborted) return;
    renewing = true;
    void extendLease(job.id, workerId, job.attempts).then(owned => {
      if (!owned) ctrl.abort(new Error("Job lease lost."));
    }).catch(() => { ctrl.abort(new Error("Job lease renewal failed.")); }).finally(() => { renewing = false; });
  }, Math.floor(jobLeaseMs() / 3));
  try {
    if (!await extendLease(job.id, workerId, job.attempts)) throw new Error("Job lease lost before execution.");
    if (!h) throw new Error(`No handler for ${job.kind}`);
    obs("job.claimed", { kind: job.kind });
    await h(job.payload, job);
    ctrl.signal.throwIfAborted();
    if (!await completeJob(job)) throw new Error("Job lease lost before completion.");
    obs("job.completed", { kind: job.kind });
    return true;
  } catch (e) {
    if (e instanceof DriverBusy && !ctrl.signal.aborted) {
      await deferJob(job, e.until);
      obs("job.deferred", { kind: job.kind, runAt: e.until.toISOString() });
      return true;
    }
    const dead = await failJob(job, errorSummary(e));
    obs(dead ? "job.dead" : "job.retry", { jobId: job.id, kind: job.kind, attempt: job.attempts, error: errorSummary(e) });
    return false;
  } finally { clearInterval(lease); }
  });
}

/** Runs a single drain pass (used by tests and CLI). */
export async function drainOnce(workerId = "drain", limit = 20, workspaceId?: string) {
  const claimed = await claim(workerId, limit, workspaceId);
  await Promise.all(claimed.map((j) => processJob(j, workerId)));
  return claimed.length;
}

type WorkerOpts = { mode?: string; concurrency?: number; pollMs?: number; schedules?: boolean };
const g = globalThis as typeof globalThis & { __marcWorker?: { id: string; stop: () => Promise<void> } };

/** Long-lived worker: claims jobs, ticks schedules, recovers orphans, heartbeats. Safe to run N copies. */
export function startWorker(o: WorkerOpts = {}) {
  if (g.__marcWorker) return g.__marcWorker;
  const id = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 6)}`;
  const concurrency = o.concurrency ?? Number(process.env.MACHINARC_WORKER_CONCURRENCY ?? process.env.MARC_WORKER_CONCURRENCY ?? 2);
  const pollMs = o.pollMs ?? Number(process.env.MACHINARC_POLL_INTERVAL_MS ?? 3000);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 || !Number.isInteger(pollMs) || pollMs < 500) throw new Error("Invalid worker concurrency or polling interval.");
  const inflight = new Set<Promise<void>>();
  let active = 0, processed = 0, failed = 0, lastTick = 0, lastRecover = 0, lastBeat = 0, lastCleanup = 0;

  async function beat() {
    await db.insert(workerHeartbeats).values({ id, host: os.hostname(), mode: o.mode ?? "in-process", jobsProcessed: processed, jobsFailed: failed })
      .onConflictDoUpdate({ target: workerHeartbeats.id, set: { lastBeatAt: new Date(), jobsProcessed: processed, jobsFailed: failed } });
  }
  const polling = startWorkerLoop(async (isStopped) => {
    const now = Date.now();
    if (now - lastBeat > 10_000) { lastBeat = now; await beat(); }
    if (isStopped()) return;
    if (o.schedules !== false && now - lastTick > 10_000) { lastTick = now; await tickSchedules(); }
    if (isStopped()) return;
    if (now - lastRecover > 30_000) { lastRecover = now; await recoverOrphans(); }
    if (isStopped()) return;
    if (now - lastCleanup > 60_000) { lastCleanup = now; await maybeCleanupVisitorDemos(); }
    if (isStopped()) return;
    const free = concurrency - active;
    if (free > 0) {
      const claimed = await claim(id, free);
      for (const j of claimed) {
        active++;
        const execution = processJob(j, id).then((ok) => { ok ? processed++ : failed++; })
          .catch(error => { failed++; obs("worker.job_error", { jobId: j.id, error: errorSummary(error) }); })
          .finally(() => { active--; inflight.delete(execution); polling.wake(); });
        inflight.add(execution);
      }
    }
  }, pollMs, (error) => obs("worker.loop_error", { error: errorSummary(error) }));
  wakeListeners.add(polling.wake);
  obs("worker.started", { id, concurrency, mode: o.mode ?? "in-process" });
  const handle = { id, stop: async () => {
    wakeListeners.delete(polling.wake);
    await polling.stopAndWait();
    await Promise.allSettled([...inflight]);
    if (g.__marcWorker?.id === id) g.__marcWorker = undefined;
    obs("worker.stopped", { workerId: id });
  } };
  g.__marcWorker = handle;
  return handle;
}

export async function liveWorkers(withinMs = 30_000) {
  return db.select().from(workerHeartbeats).where(sql`${workerHeartbeats.lastBeatAt} > (now() at time zone 'UTC') - (${String(withinMs)} || ' milliseconds')::interval`);
}
