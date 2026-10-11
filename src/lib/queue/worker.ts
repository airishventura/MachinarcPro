import "server-only";
import os from "node:os";
import { and, eq, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { arcRuns, jobs, machineRuns, machines, workerHeartbeats } from "@/db/schema";
import { claim, completeJob, enqueue, extendLease, failJob, wakeListeners, type Job } from "@/lib/queue/queue";
import { fireTarget, tickSchedules } from "@/lib/automation/triggers";
import { obs } from "@/lib/security/redact";
import { startWorkerLoop } from "@/lib/queue/worker-loop";
import { maybeCleanupVisitorDemos } from "@/lib/seed/demo-cleanup";

type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

/** Job handlers. Every handler is idempotent: runtimes are lock-guarded and resume from persisted state. */
export const HANDLERS: Record<string, Handler> = {
  "machine.deploy": async (p) => {
    const { MachineRuntime } = await import("@/lib/runtime/machine-runtime");
    const rt = await MachineRuntime.load(String(p.machineId), String(p.workspaceId));
    await rt.deploy();
  },
  "machine.execute": async (p) => {
    const { MachineRuntime } = await import("@/lib/runtime/machine-runtime");
    await MachineRuntime.resume(String(p.runId));
  },
  "arc.drive": async (p) => {
    const { ArcRuntime } = await import("@/lib/arcs/runtime");
    await ArcRuntime.drive(String(p.runId));
  },
  "trigger.fire": async (p, job) => {
    await fireTarget({ workspaceId: String(job.workspaceId), jobId: job.id, targetType: String(p.targetType), targetId: String(p.targetId), input: String(p.input ?? ""), source: p.source as "schedule", sourceId: p.sourceId ? String(p.sourceId) : null, depth: Number(p.depth ?? 0), overlap: p.overlap === "queue" ? "queue" : "skip" });
  },
};

const ORPHAN = ["queued", "initializing", "running", "waiting_tool"] as const;

/** Crash recovery: re-enqueue runs whose driver vanished (expired lock, no active job). */
export async function recoverOrphans(workspaceId?: string) {
  const activeJob = (key: ReturnType<typeof sql>) => db.select({ x: sql`1` }).from(jobs).where(and(sql`${jobs.dedupeKey} = ${key}`, inArray(jobs.status, ["queued", "running"])));
  const mr = await db.select({ id: machineRuns.id, ws: machines.workspaceId }).from(machineRuns).innerJoin(machines, eq(machines.id, machineRuns.machineId))
    .where(and(workspaceId ? eq(machines.workspaceId, workspaceId) : undefined, inArray(machineRuns.status, [...ORPHAN]), or(isNull(machineRuns.lockUntil), lt(machineRuns.lockUntil, new Date())), lt(machineRuns.createdAt, new Date(Date.now() - 15_000)), notExists(activeJob(sql`'machine:' || ${machineRuns.id}`)))).limit(50);
  for (const r of mr) await enqueue("machine.execute", { runId: r.id }, { workspaceId: r.ws, dedupeKey: `machine:${r.id}` });
  const ar = await db.select({ id: arcRuns.id, ws: arcRuns.workspaceId }).from(arcRuns)
    .where(and(workspaceId ? eq(arcRuns.workspaceId, workspaceId) : undefined, inArray(arcRuns.status, ["queued", "running"]), or(isNull(arcRuns.lockUntil), lt(arcRuns.lockUntil, new Date())), lt(arcRuns.createdAt, new Date(Date.now() - 15_000)))).limit(50);
  for (const r of ar) await enqueue("arc.drive", { runId: r.id }, { workspaceId: r.ws, dedupeKey: `arc-recover:${r.id}` });
  return mr.length + ar.length;
}

export async function processJob(job: Job, workerId: string) {
  const h = HANDLERS[job.kind];
  const lease = setInterval(() => { void extendLease(job.id, workerId); }, 60_000);
  try {
    if (!h) throw new Error(`No handler for ${job.kind}`);
    await h(job.payload, job);
    await completeJob(job);
    return true;
  } catch (e) {
    const dead = await failJob(job, e instanceof Error ? e.message : String(e));
    obs(dead ? "job.dead" : "job.retry", { jobId: job.id, kind: job.kind, attempt: job.attempts, error: String(e) });
    return false;
  } finally { clearInterval(lease); }
}

/** Runs a single drain pass (used by tests and CLI). */
export async function drainOnce(workerId = "drain", limit = 20, workspaceId?: string) {
  const claimed = await claim(workerId, limit, workspaceId);
  await Promise.all(claimed.map((j) => processJob(j, workerId)));
  return claimed.length;
}

type WorkerOpts = { mode?: string; concurrency?: number; pollMs?: number };
const g = globalThis as typeof globalThis & { __marcWorker?: { id: string; stop: () => void } };

/** Long-lived worker: claims jobs, ticks schedules, recovers orphans, heartbeats. Safe to run N copies. */
export function startWorker(o: WorkerOpts = {}) {
  if (g.__marcWorker) return g.__marcWorker;
  const id = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 6)}`;
  const concurrency = o.concurrency ?? Number(process.env.MARC_WORKER_CONCURRENCY ?? 4);
  const pollMs = o.pollMs ?? 1500;
  let active = 0, processed = 0, failed = 0, lastTick = 0, lastRecover = 0, lastBeat = 0, lastCleanup = 0;

  async function beat() {
    await db.insert(workerHeartbeats).values({ id, host: os.hostname(), mode: o.mode ?? "in-process", jobsProcessed: processed, jobsFailed: failed })
      .onConflictDoUpdate({ target: workerHeartbeats.id, set: { lastBeatAt: new Date(), jobsProcessed: processed, jobsFailed: failed } });
  }
  const polling = startWorkerLoop(async (isStopped) => {
    const now = Date.now();
    if (now - lastBeat > 10_000) { lastBeat = now; await beat(); }
    if (isStopped()) return;
    if (now - lastTick > 10_000) { lastTick = now; await tickSchedules(); }
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
        void processJob(j, id).then((ok) => { ok ? processed++ : failed++; }).finally(() => { active--; polling.wake(); });
      }
    }
  }, pollMs, (error) => obs("worker.loop_error", { error: String(error) }));
  wakeListeners.add(polling.wake);
  obs("worker.started", { id, concurrency, mode: o.mode ?? "in-process" });
  const handle = { id, stop: () => { polling.stop(); wakeListeners.delete(polling.wake); if (g.__marcWorker?.id === id) g.__marcWorker = undefined; } };
  g.__marcWorker = handle;
  return handle;
}

export async function liveWorkers(withinMs = 30_000) {
  return db.select().from(workerHeartbeats).where(sql`${workerHeartbeats.lastBeatAt} > now() - (${String(withinMs)} || ' milliseconds')::interval`);
}
