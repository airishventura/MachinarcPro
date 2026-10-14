"use server";
import { enqueue, notifyWorkers } from "@/lib/queue/queue";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activities, arcRuns, arcs, jobs } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { RuntimeError } from "@/lib/runtime/machine-runtime";
import { ArcRuntime, loadArcGraph, workspaceMachines } from "@/lib/arcs/runtime";
import { createArc, getArcForWorkspace, instantiateTemplate, saveGraph, TRIGGER_TYPES } from "@/lib/arcs/service";
import type { Check, Graph } from "@/lib/arcs/graph";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; checks?: Check[] };
function fail(where: string, e: unknown, fallback: string): { ok: false; error: string } {
  if (e instanceof RuntimeError) return { ok: false, error: e.userMessage };
  console.error(`[arc.${where}]`, e);
  return { ok: false, error: fallback };
}

export async function createArcAction(_: unknown, fd: FormData): Promise<{ error?: string } | undefined> {
  const s = await requireSession();
  let id: string;
  try {
    const arc = await createArc(s.workspace.id, { name: String(fd.get("name") ?? ""), description: String(fd.get("description") ?? ""), objective: String(fd.get("objective") ?? ""), triggerType: String(fd.get("triggerType") ?? "manual") });
    id = arc.id;
  } catch (e) { return { error: fail("create", e, "The Arc could not be created. Please retry.").error }; }
  redirect(`/app/arcs/${id}/edit`);
}

export async function applyArcTemplateAction(key: string) {
  const s = await requireSession();
  let id: string;
  try { id = (await instantiateTemplate(s.workspace.id, key)).id; }
  catch (e) { return fail("template", e, "Template could not be copied."); }
  redirect(`/app/arcs/${id}/edit`);
}

export async function saveArcAction(arcId: string, graph: Graph, settings?: { name: string; description: string; objective: string; triggerType: string }, viewport?: { x: number; y: number; zoom: number }): Promise<Result<{ savedAt: string }>> {
  const s = await requireSession();
  try {
    const arc = await getArcForWorkspace(arcId, s.workspace.id);
    if (!arc) return { ok: false, error: "Arc not found." };
    await saveGraph(arcId, s.workspace.id, graph, viewport);
    if (settings) {
      const name = settings.name.trim().toUpperCase().slice(0, 60);
      await db.update(arcs).set({ name: name.length >= 3 ? name : arc.name, description: settings.description.slice(0, 300), objective: settings.objective.slice(0, 1000), triggerType: (TRIGGER_TYPES as readonly string[]).includes(settings.triggerType) ? settings.triggerType : arc.triggerType }).where(eq(arcs.id, arcId));
    }
    return { ok: true, savedAt: new Date().toISOString() };
  } catch (e) { return fail("save", e, "SAVE FAILED — your changes are kept locally. Retrying."); }
}

export async function validateArcAction(arcId: string): Promise<Result<{ checks: Check[]; valid: boolean }>> {
  const s = await requireSession();
  const arc = await getArcForWorkspace(arcId, s.workspace.id);
  if (!arc) return { ok: false, error: "Arc not found." };
  const v = ArcRuntime.validateArc(await loadArcGraph(arcId), await workspaceMachines(s.workspace.id));
  return { ok: true, checks: v.checks, valid: v.valid };
}

export async function deployArcAction(arcId: string): Promise<Result> {
  const s = await requireSession();
  try {
    const arc = await getArcForWorkspace(arcId, s.workspace.id);
    if (!arc) return { ok: false, error: "Arc not found." };
    const v = ArcRuntime.validateArc(await loadArcGraph(arcId), await workspaceMachines(s.workspace.id));
    if (!v.valid) return { ok: false, error: `ARC INVALID — ${v.errors} issue${v.errors > 1 ? "s" : ""} must be resolved before deployment.`, checks: v.checks };
    await db.update(arcs).set({ status: "deployed", updatedAt: new Date() }).where(eq(arcs.id, arcId));
    await db.insert(activities).values({ workspaceId: s.workspace.id, category: "arcs", actor: arc.name, message: `${arc.name} deployed.`, severity: "success" });
    revalidatePath(`/app/arcs/${arcId}`);
    return { ok: true };
  } catch (e) { return fail("deploy", e, "Deployment failed. Please retry."); }
}

export async function setArcPausedAction(arcId: string, paused: boolean): Promise<Result> {
  const s = await requireSession();
  const arc = await getArcForWorkspace(arcId, s.workspace.id);
  if (!arc) return { ok: false, error: "Arc not found." };
  if (arc.status === "draft") return { ok: false, error: "Draft Arcs cannot be paused. Deploy first." };
  await db.update(arcs).set({ status: paused ? "paused" : "deployed", updatedAt: new Date() }).where(eq(arcs.id, arcId));
  await db.insert(activities).values({ workspaceId: s.workspace.id, category: "arcs", actor: arc.name, message: `${arc.name} ${paused ? "paused — active runs will finish, new runs are blocked" : "resumed"}.`, severity: paused ? "warning" : "info" });
  revalidatePath(`/app/arcs/${arcId}`);
  return { ok: true };
}

export async function runArcAction(arcId: string, input: string, opts: { test?: boolean } = {}): Promise<Result<{ runId: string }>> {
  const s = await requireSession();
  const text = input.trim();
  if (!text) return { ok: false, error: "Provide trigger input for this run." };
  if (text.length > 4000) return { ok: false, error: "Trigger input is limited to 4000 characters." };
  try {
    const run = await db.transaction(async tx => {
      const created = await ArcRuntime.createRun(arcId, s.workspace.id, text, { isTest: !!opts.test }, tx);
      await tx.insert(jobs).values({ kind: "arc.drive", payload: { runId: created.id }, workspaceId: s.workspace.id, dedupeKey: `arc:${created.id}` });
      return created;
    });
    notifyWorkers();
    revalidatePath(`/app/arcs/${arcId}`);
    return { ok: true, runId: run.id };
  } catch (e) { return fail("run", e, "The Arc Run could not be started."); }
}

export async function retryArcRunAction(runId: string): Promise<Result<{ runId: string; arcId: string }>> {
  const s = await requireSession();
  const [prev] = await db.select().from(arcRuns).where(and(eq(arcRuns.id, runId), eq(arcRuns.workspaceId, s.workspace.id)));
  if (!prev) return { ok: false, error: "Run not found." };
  const r = await runArcAction(prev.arcId, prev.triggerPayload.input, { test: prev.isTest });
  return r.ok ? { ok: true, runId: r.runId, arcId: prev.arcId } : r;
}

export async function decideArcApprovalAction(approvalId: string, approve: boolean): Promise<Result> {
  const s = await requireSession();
  try {
    const runId = await ArcRuntime.resumeApproval(approvalId, s.workspace.id, s.user.id, approve);
    await enqueue("arc.drive", { runId }, { workspaceId: s.workspace.id });
    return { ok: true };
  } catch (e) { return fail("approval", e, "The decision could not be recorded."); }
}

export async function cancelArcRunAction(runId: string): Promise<Result> {
  const s = await requireSession();
  try { await ArcRuntime.cancelRun(runId, s.workspace.id); return { ok: true }; }
  catch (e) { return fail("cancel", e, "The run could not be cancelled."); }
}

export async function deleteArcAction(arcId: string): Promise<Result> {
  const s = await requireSession();
  const arc = await getArcForWorkspace(arcId, s.workspace.id);
  if (!arc) return { ok: false, error: "Arc not found." };
  const [active] = await db.select({ id: arcRuns.id }).from(arcRuns).where(and(eq(arcRuns.arcId, arcId), inArray(arcRuns.status, ["queued", "running", "waiting_approval", "waiting_delay"]))).limit(1);
  if (active) return { ok: false, error: "This Arc has an active run. Cancel or finish it before deleting." };
  await db.update(arcs).set({ deletedAt: new Date(), status: "disabled" }).where(eq(arcs.id, arcId));
  await db.insert(activities).values({ workspaceId: s.workspace.id, category: "arcs", actor: arc.name, message: `${arc.name} deleted.`, severity: "warning" });
  redirect("/app/arcs");
}
