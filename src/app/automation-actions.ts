"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, eventTriggers, jobs, schedules, webhooks } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { computeNextRun, resolveTarget } from "@/lib/automation/triggers";
import { parseCron } from "@/lib/automation/cron";
import { enqueue } from "@/lib/queue/queue";
import { mintWebhookToken } from "@/lib/automation/webhook-token";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const P = "/app/automation";
const log = (workspaceId: string, actor: string, message: string) => db.insert(activities).values({ workspaceId, category: "system", actor, message });

export async function createScheduleAction(f: { name: string; targetType: string; targetId: string; kind: "interval" | "cron"; intervalMin?: number; cron?: string; input: string; overlap: "skip" | "queue" }): Promise<R> {
  const s = await requireSession();
  const target = await resolveTarget(s.workspace.id, f.targetType, f.targetId);
  if (!target) return { ok: false, error: "Choose a Machine or Arc from this workspace." };
  const name = f.name.trim().slice(0, 60) || `${target.name} schedule`;
  let intervalSec: number | null = null, cron: string | null = null;
  if (f.kind === "interval") {
    const m = Math.round(Number(f.intervalMin));
    if (!(m >= 1 && m <= 43200)) return { ok: false, error: "Interval must be between 1 minute and 30 days." };
    intervalSec = m * 60;
  } else {
    try { parseCron(f.cron ?? ""); cron = f.cron!.trim(); } catch (e) { return { ok: false, error: `Invalid cron: ${(e as Error).message}` }; }
  }
  const nextRunAt = computeNextRun({ kind: f.kind, intervalSec, cron });
  await db.insert(schedules).values({ workspaceId: s.workspace.id, name, targetType: target.type, targetId: target.id, kind: f.kind, intervalSec, cron, input: f.input.slice(0, 4000), overlap: f.overlap === "queue" ? "queue" : "skip", nextRunAt });
  await log(s.workspace.id, s.user.name, `Schedule "${name}" created for ${target.name}.`);
  revalidatePath(P);
  return { ok: true };
}

export async function toggleScheduleAction(id: string, enabled: boolean): Promise<R> {
  const s = await requireSession();
  const [row] = await db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.workspaceId, s.workspace.id)));
  if (!row) return { ok: false, error: "Schedule not found." };
  await db.update(schedules).set({ enabled, nextRunAt: enabled ? computeNextRun(row) : row.nextRunAt }).where(eq(schedules.id, id));
  revalidatePath(P);
  return { ok: true };
}

export async function runScheduleNowAction(id: string): Promise<R> {
  const s = await requireSession();
  const [row] = await db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.workspaceId, s.workspace.id)));
  if (!row) return { ok: false, error: "Schedule not found." };
  await enqueue("trigger.fire", { source: "schedule", sourceId: row.id, targetType: row.targetType, targetId: row.targetId, input: row.input, overlap: row.overlap, depth: 0 }, { workspaceId: s.workspace.id, dedupeKey: `sched-now:${row.id}` });
  revalidatePath(P);
  return { ok: true };
}

export async function deleteScheduleAction(id: string): Promise<R> {
  const s = await requireSession();
  await db.delete(schedules).where(and(eq(schedules.id, id), eq(schedules.workspaceId, s.workspace.id)));
  revalidatePath(P);
  return { ok: true };
}

/** Returns the plaintext token exactly once. Only its hash is stored. */
export async function createWebhookAction(f: { name: string; targetType: string; targetId: string; inputTemplate: string }): Promise<R<{ token: string }>> {
  const s = await requireSession();
  const target = await resolveTarget(s.workspace.id, f.targetType, f.targetId);
  if (!target) return { ok: false, error: "Choose a Machine or Arc from this workspace." };
  const { token, prefix, hash } = mintWebhookToken();
  const tpl = f.inputTemplate.trim().slice(0, 2000) || "{{body}}";
  await db.insert(webhooks).values({ workspaceId: s.workspace.id, name: f.name.trim().slice(0, 60) || `${target.name} webhook`, targetType: target.type, targetId: target.id, tokenPrefix: prefix, tokenHash: hash, inputTemplate: tpl });
  await log(s.workspace.id, s.user.name, `Webhook created for ${target.name}.`);
  revalidatePath(P);
  return { ok: true, token };
}
export async function toggleWebhookAction(id: string, enabled: boolean): Promise<R> {
  const s = await requireSession();
  await db.update(webhooks).set({ enabled }).where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, s.workspace.id)));
  revalidatePath(P);
  return { ok: true };
}
export async function deleteWebhookAction(id: string): Promise<R> {
  const s = await requireSession();
  await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, s.workspace.id)));
  revalidatePath(P);
  return { ok: true };
}

export async function createEventTriggerAction(f: { name: string; sourceType: string; sourceId: string; onStatus: string; targetType: string; targetId: string; inputTemplate: string }): Promise<R> {
  const s = await requireSession();
  const [src, tgt] = await Promise.all([resolveTarget(s.workspace.id, f.sourceType, f.sourceId), resolveTarget(s.workspace.id, f.targetType, f.targetId)]);
  if (!src || !tgt) return { ok: false, error: "Source and target must exist in this workspace." };
  if (src.id === tgt.id) return { ok: false, error: "A trigger cannot start its own source — that would loop." };
  if (!["completed", "failed", "any"].includes(f.onStatus)) return { ok: false, error: "Invalid condition." };
  await db.insert(eventTriggers).values({ workspaceId: s.workspace.id, name: f.name.trim().slice(0, 60) || `${src.name} → ${tgt.name}`, sourceType: src.type, sourceId: src.id, onStatus: f.onStatus, targetType: tgt.type, targetId: tgt.id, inputTemplate: f.inputTemplate.trim().slice(0, 2000) || "{{output}}" });
  await log(s.workspace.id, s.user.name, `Event trigger ${src.name} → ${tgt.name} created.`);
  revalidatePath(P);
  return { ok: true };
}
export async function toggleEventTriggerAction(id: string, enabled: boolean): Promise<R> {
  const s = await requireSession();
  await db.update(eventTriggers).set({ enabled }).where(and(eq(eventTriggers.id, id), eq(eventTriggers.workspaceId, s.workspace.id)));
  revalidatePath(P);
  return { ok: true };
}
export async function deleteEventTriggerAction(id: string): Promise<R> {
  const s = await requireSession();
  await db.delete(eventTriggers).where(and(eq(eventTriggers.id, id), eq(eventTriggers.workspaceId, s.workspace.id)));
  revalidatePath(P);
  return { ok: true };
}

export async function retryJobAction(id: string): Promise<R> {
  const s = await requireSession();
  const [j] = await db.update(jobs).set({ status: "queued", runAt: new Date(), attempts: 0, lastError: null, completedAt: null }).where(and(eq(jobs.id, id), eq(jobs.workspaceId, s.workspace.id), eq(jobs.status, "dead"))).returning();
  if (!j) return { ok: false, error: "Only dead-lettered jobs can be retried." };
  revalidatePath(P);
  return { ok: true };
}
