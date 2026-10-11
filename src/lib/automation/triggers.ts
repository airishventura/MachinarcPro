import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { activities, arcs, eventTriggers, jobs, machineRuns, machines, schedules, triggerFires, webhooks } from "@/db/schema";
import { enqueue, enqueueInTransaction, notifyWorkers } from "@/lib/queue/queue";
import { nextCron } from "@/lib/automation/cron";
import { obs } from "@/lib/security/redact";

export type TargetType = "machine" | "arc";
export type FireSource = "schedule" | "webhook" | "event";
export const MAX_TRIGGER_CHAIN = 5;
const ACTIVE = ["queued", "initializing", "running", "waiting_tool", "waiting_approval"] as const;

/** Verifies a target belongs to the workspace (never trust ids from clients or payloads). */
export async function resolveTarget(workspaceId: string, type: string, id: string, reader: Pick<typeof db, "select"> = db) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (type === "machine") { const [m] = await reader.select({ id: machines.id, name: machines.name }).from(machines).where(and(eq(machines.id, id), eq(machines.workspaceId, workspaceId))); return m ? { type: "machine" as const, ...m } : null; }
  if (type === "arc") { const [a] = await reader.select({ id: arcs.id, name: arcs.name }).from(arcs).where(and(eq(arcs.id, id), eq(arcs.workspaceId, workspaceId))); return a ? { type: "arc" as const, ...a } : null; }
  return null;
}

/**
 * Starts a Machine task or Arc Run on behalf of an automated trigger and hands execution to the
 * durable queue. Honors pause state, overlap policy, Arc deployment state and trigger-chain depth.
 */
export async function fireTarget(p: { workspaceId: string; targetType: string; targetId: string; input: string; source: FireSource; sourceId?: string | null; depth?: number; overlap?: "skip" | "queue"; jobId?: string }) {
  const depth = p.depth ?? 0;
  const base = { workspaceId: p.workspaceId, source: p.source, sourceId: p.sourceId, targetType: p.targetType, targetId: p.targetId };
  const input = (p.input || `Automated ${p.source} run`).slice(0, 4000);
  const result = await db.transaction(async (tx) => {
    // Reclaimed jobs retain their UUID. The receipt and all creation writes commit together.
    if (p.jobId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`trigger-job:${p.jobId}`}, 0))`);
      const [receipt] = await tx.select().from(triggerFires).where(eq(triggerFires.id, p.jobId));
      if (receipt) {
        if (receipt.workspaceId !== p.workspaceId) throw new Error("Trigger receipt workspace mismatch.");
        return { status: receipt.status as "started" | "skipped" | "failed", ...(receipt.ref ? { ref: receipt.ref } : {}), ...(receipt.reason ? { reason: receipt.reason } : {}) };
      }
    }
    const record = async (outcome: { status: "started" | "skipped" | "failed"; reason?: string; ref?: string }) => {
      await tx.insert(triggerFires).values({ ...base, id: p.jobId, sourceId: p.sourceId ?? null, ...outcome, reason: outcome.reason?.slice(0, 300) ?? null, ref: outcome.ref ?? null });
      if (p.jobId && p.source === "schedule" && p.sourceId) await tx.update(schedules).set({ lastStatus: outcome.status, runCount: sql`${schedules.runCount} + ${outcome.status === "started" ? 1 : 0}`, failCount: sql`${schedules.failCount} + ${outcome.status === "failed" ? 1 : 0}` }).where(and(eq(schedules.id, p.sourceId), eq(schedules.workspaceId, p.workspaceId)));
      return outcome;
    };
    if (depth > MAX_TRIGGER_CHAIN) return record({ status: "skipped", reason: `Trigger chain depth limit (${MAX_TRIGGER_CHAIN}) reached — possible loop.` });
    // Different fires serialize overlap checks and run numbering for the same target too.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`trigger-target:${p.targetType}:${p.targetId}`}, 0))`);
    const target = await resolveTarget(p.workspaceId, p.targetType, p.targetId, tx);
    if (!target) return record({ status: "failed", reason: "Target no longer exists in this workspace." });
    const { MachineRuntime, RuntimeError } = await import("@/lib/runtime/machine-runtime");
    try {
      if (target.type === "machine") {
        const rt = await MachineRuntime.load(target.id, p.workspaceId, tx);
        if (rt.machine.status === "paused") return record({ status: "skipped", reason: "Machine is paused." });
        if ((p.overlap ?? "skip") === "skip") {
          const [busy] = await tx.select({ id: machineRuns.id }).from(machineRuns).where(and(eq(machineRuns.machineId, target.id), inArray(machineRuns.status, [...ACTIVE]))).limit(1);
          if (busy) return record({ status: "skipped", reason: "Previous run still active (overlap: skip)." });
        }
        const { task, run } = await rt.createRun(input, p.source, { allowBusy: true, triggerDepth: depth }, tx);
        await tx.insert(jobs).values({ kind: "machine.execute", payload: { runId: run.id }, workspaceId: p.workspaceId, dedupeKey: `machine:${run.id}` }).onConflictDoNothing();
        await tx.insert(activities).values({ workspaceId: p.workspaceId, machineId: target.id, category: "system", actor: target.name, message: `${target.name} started by ${p.source} trigger (task #${task.number}).` });
        return record({ status: "started", ref: task.id });
      }
      const { ArcRuntime } = await import("@/lib/arcs/runtime");
      const run = await ArcRuntime.createRun(target.id, p.workspaceId, input, { isTest: false, source: p.source, triggerDepth: depth }, tx);
      await tx.insert(jobs).values({ kind: "arc.drive", payload: { runId: run.id }, workspaceId: p.workspaceId, dedupeKey: `arc:${run.id}` }).onConflictDoNothing();
      return record({ status: "started", ref: run.id });
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e; // Roll back infrastructure failures for queue retry.
      const reason = e.userMessage;
      const skipped = /already|paused|PAUSED|Deploy the Arc/i.test(reason);
      if (!skipped) obs("trigger.fire_failed", { source: p.source, error: String(e) });
      return record({ status: skipped ? "skipped" : "failed", reason });
    }
  });
  if (result.status === "started") notifyWorkers();
  return result;
}

export function renderTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars[k] ?? "").slice(0, 6000)).slice(0, 4000);
}

/** Called when a Machine run or Arc Run reaches a terminal state. Fans out to matching event triggers. */
export async function emitEvent(e: { workspaceId: string; sourceType: TargetType; sourceId: string; status: string; output: string; depth: number; name: string }) {
  if (e.status === "cancelled") return;
  const rows = await db.select().from(eventTriggers).where(and(eq(eventTriggers.workspaceId, e.workspaceId), eq(eventTriggers.sourceType, e.sourceType), eq(eventTriggers.sourceId, e.sourceId), eq(eventTriggers.enabled, true)));
  for (const t of rows) {
    const match = t.onStatus === "any" || (t.onStatus === "completed" ? e.status === "completed" : e.status !== "completed");
    if (!match) continue;
    const input = renderTemplate(t.inputTemplate, { output: e.output, status: e.status, source: e.name });
    await enqueue("trigger.fire", { source: "event", sourceId: t.id, targetType: t.targetType, targetId: t.targetId, input, depth: e.depth + 1 }, { workspaceId: e.workspaceId });
    await db.update(eventTriggers).set({ fireCount: sql`${eventTriggers.fireCount} + 1`, lastFiredAt: new Date() }).where(eq(eventTriggers.id, t.id));
  }
}

export function computeNextRun(s: { kind: string; intervalSec: number | null; cron: string | null }, from = new Date()) {
  if (s.kind === "cron" && s.cron) return nextCron(s.cron, from);
  return new Date(from.getTime() + Math.max(60, s.intervalSec ?? 3600) * 1000);
}

/** Claims due schedules (SKIP LOCKED — safe with many workers), advances them, enqueues fires. */
export async function tickSchedules(limit = 25, workspaceId?: string) {
  const client = await pool.connect();
  const due: { id: string; workspace_id: string; target_type: string; target_id: string; input: string; overlap: string; kind: string; interval_sec: number | null; cron: string | null; next_run_at: Date }[] = [];
  try {
    await client.query("begin");
    // Schema timestamps use UTC without a zone; pg otherwise interprets these in the host timezone.
    const { rows } = await client.query(`select id, workspace_id, target_type, target_id, input, overlap, kind, interval_sec, cron, next_run_at at time zone 'UTC' as next_run_at from schedules where enabled and next_run_at <= now() and ($2::uuid is null or workspace_id = $2) order by next_run_at limit $1 for update skip locked`, [limit, workspaceId ?? null]);
    for (const r of rows) {
      let next: Date | null;
      try { next = computeNextRun({ kind: r.kind, intervalSec: r.interval_sec, cron: r.cron }); } catch { next = null; }
      await client.query(`update schedules set next_run_at = $2, last_run_at = now(), enabled = $3 where id = $1`, [r.id, next?.toISOString() ?? null, !!next]);
      await enqueueInTransaction(client, "trigger.fire", { source: "schedule", sourceId: r.id, targetType: r.target_type, targetId: r.target_id, input: r.input, overlap: r.overlap, depth: 0 }, { workspaceId: r.workspace_id, dedupeKey: `sched:${r.id}:${new Date(r.next_run_at).toISOString()}` });
      due.push(r);
    }
    await client.query("commit");
  } catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
  if (due.length) notifyWorkers();
  return due.length;
}

export async function recordScheduleOutcome(id: string, status: string) {
  await db.update(schedules).set({ lastStatus: status, runCount: sql`${schedules.runCount} + ${status === "started" ? 1 : 0}`, failCount: sql`${schedules.failCount} + ${status === "failed" ? 1 : 0}` }).where(eq(schedules.id, id));
}
export async function touchWebhook(id: string) {
  await db.update(webhooks).set({ callCount: sql`${webhooks.callCount} + 1`, lastCalledAt: new Date() }).where(eq(webhooks.id, id));
}
export { lte };
