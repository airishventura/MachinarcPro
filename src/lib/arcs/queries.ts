import "server-only";
import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { arcApprovals, arcEdges, arcNodes, arcRunNodes, arcRuns, arcs, machineLogs } from "@/db/schema";
import { ArcRuntime, isTerminal, loadArcGraph, runCode, workspaceMachines } from "@/lib/arcs/runtime";
import { topoOrder, type Graph } from "@/lib/arcs/graph";
import type { ArcCardDTO, ArcDisplayStatus, ArcRunRowDTO, ArcRunStateDTO } from "@/types/arc";

type Arc = typeof arcs.$inferSelect;
type Run = typeof arcRuns.$inferSelect;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function displayStatus(arc: Arc, latest?: Pick<Run, "status"> | null): ArcDisplayStatus {
  if (latest && !isTerminal(latest.status)) return latest.status.startsWith("waiting") ? "waiting" : "running";
  if (arc.status === "paused") return "paused";
  if (arc.status === "draft") return "draft";
  if (arc.status === "disabled") return "disabled";
  return arc.lastRunStatus === "failed" ? "failed" : "idle";
}

const toRow = (r: Run, arcName: string, machines: number): ArcRunRowDTO => ({ id: r.id, code: runCode(r.number), arcId: r.arcId, arcName, status: r.status, isTest: r.isTest, machines, durationMs: r.durationMs || (r.startedAt && !isTerminal(r.status) ? Date.now() - r.startedAt.getTime() : 0), cost: r.cost, createdAt: r.createdAt.toISOString(), input: r.triggerPayload.input });

export async function listArcs(workspaceId: string): Promise<ArcCardDTO[]> {
  const rows = await db.select().from(arcs).where(and(eq(arcs.workspaceId, workspaceId), isNull(arcs.deletedAt))).orderBy(desc(arcs.updatedAt));
  if (!rows.length) return [];
  const ids = rows.map((a) => a.id);
  const [nodes, edges, runs] = await Promise.all([
    db.select().from(arcNodes).where(inArray(arcNodes.arcId, ids)),
    db.select().from(arcEdges).where(inArray(arcEdges.arcId, ids)),
    db.select().from(arcRuns).where(and(inArray(arcRuns.arcId, ids), notInArray(arcRuns.status, ["completed", "failed", "cancelled"]))),
  ]);
  const activeRunIds = runs.map((r) => r.id);
  const running = activeRunIds.length ? await db.select().from(arcRunNodes).where(and(inArray(arcRunNodes.arcRunId, activeRunIds), inArray(arcRunNodes.status, ["running", "waiting"]))) : [];
  return rows.map((a) => {
    const ns = nodes.filter((n) => n.arcId === a.id);
    const g: Graph = { nodes: ns.map((n) => ({ key: n.nodeKey, type: n.nodeType, label: n.label, machineId: n.machineId, x: n.positionX, y: n.positionY, config: {} })), edges: edges.filter((e) => e.arcId === a.id).map((e) => ({ id: e.edgeKey, source: e.sourceNodeKey, target: e.targetNodeKey, sourceHandle: e.sourceHandle })) };
    const order = topoOrder(g) ?? g.nodes.map((n) => n.key);
    const chain = order.map((k) => g.nodes.find((n) => n.key === k)!).filter((n) => n.type !== "trigger").map((n) => n.label);
    const active = runs.find((r) => r.arcId === a.id);
    const cur = active ? running.find((rn) => rn.arcRunId === active.id) : null;
    return {
      id: a.id, name: a.name, arcCode: a.arcCode, description: a.description, status: displayStatus(a, active), nodesCount: ns.length,
      chain, machinesCount: new Set(ns.filter((n) => n.nodeType === "machine").map((n) => n.machineId ?? n.nodeKey)).size,
      runsCompleted: a.runsCompleted, successRate: a.successRate, lastRunAt: iso(a.lastRunAt),
      activity: cur ? `${cur.label} ${cur.status === "waiting" ? "awaiting operator" : "executing"}` : active ? `${runCode(active.number)} ${active.status.replace("_", " ")}` : null,
    };
  });
}

export async function getArcDetail(arcId: string, workspaceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(arcId)) return null;
  const [arc] = await db.select().from(arcs).where(and(eq(arcs.id, arcId), eq(arcs.workspaceId, workspaceId), isNull(arcs.deletedAt)));
  if (!arc) return null;
  const [graph, machines, runs] = await Promise.all([
    loadArcGraph(arcId), workspaceMachines(workspaceId),
    db.select().from(arcRuns).where(eq(arcRuns.arcId, arcId)).orderBy(desc(arcRuns.createdAt)).limit(40),
  ]);
  const counts = runs.length ? await db.select({ id: arcRunNodes.arcRunId, n: sql<number>`count(*)::int` }).from(arcRunNodes).where(and(inArray(arcRunNodes.arcRunId, runs.map((r) => r.id)), eq(arcRunNodes.nodeType, "machine"), notInArray(arcRunNodes.status, ["skipped", "pending"]))).groupBy(arcRunNodes.arcRunId) : [];
  const active = runs.find((r) => !isTerminal(r.status));
  return {
    arc, graph, machines, status: displayStatus(arc, active), activeRunId: active?.id ?? null,
    runs: runs.map((r) => toRow(r, arc.name, counts.find((c) => c.id === r.id)?.n ?? 0)),
  };
}

export async function getRunState(workspaceId: string, arcId: string, runId: string): Promise<ArcRunStateDTO | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const [run] = await db.select().from(arcRuns).where(and(eq(arcRuns.id, runId), eq(arcRuns.arcId, arcId), eq(arcRuns.workspaceId, workspaceId)));
  if (!run) return null;
  const [rns, events, approvals] = await Promise.all([
    db.select().from(arcRunNodes).where(eq(arcRunNodes.arcRunId, runId)),
    ArcRuntime.events(runId),
    db.select().from(arcApprovals).where(and(eq(arcApprovals.arcRunId, runId), eq(arcApprovals.workspaceId, workspaceId))).orderBy(desc(arcApprovals.createdAt)),
  ]);
  const graph = run.graphSnapshot as unknown as Graph;
  const liveTasks = rns.filter((r) => r.status === "running" && r.machineTaskId).map((r) => r.machineTaskId!);
  const details = new Map<string, string>();
  for (const t of liveTasks) {
    const [l] = await db.select({ m: machineLogs.message }).from(machineLogs).where(eq(machineLogs.taskId, t)).orderBy(desc(machineLogs.createdAt)).limit(1);
    if (l) details.set(t, l.m);
  }
  return {
    run: { id: run.id, code: runCode(run.number), arcId: run.arcId, status: run.status, isTest: run.isTest, input: run.triggerPayload.input, finalOutput: run.finalOutput, startedAt: iso(run.startedAt), completedAt: iso(run.completedAt), durationMs: run.durationMs, estimatedCost: run.estimatedCost, cost: run.cost || rns.reduce((a, r) => a + r.cost, 0), errorMessage: run.errorMessage, failedNodeKey: run.failedNodeKey, createdAt: run.createdAt.toISOString() },
    nodes: rns.map((r) => ({
      key: r.nodeKey, type: r.nodeType, label: r.label, status: r.status, branch: r.branch, input: r.inputPayload?.text ?? null, output: r.outputPayload?.text ?? null, error: r.errorMessage,
      startedAt: iso(r.startedAt), completedAt: iso(r.completedAt), durationMs: r.durationMs, cost: r.cost, attempts: r.attempts,
      attemptLog: (r.outputPayload?.attempts as ArcRunStateDTO["nodes"][number]["attemptLog"]) ?? [],
      machineId: graph.nodes.find((n) => n.key === r.nodeKey)?.machineId ?? null, machineTaskId: r.machineTaskId, resumeAt: iso(r.resumeAt),
      detail: r.machineTaskId ? details.get(r.machineTaskId) ?? null : null,
    })),
    events: events.map((e) => ({ id: e.id, nodeKey: e.nodeKey, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
    approvals: approvals.map((a) => ({ id: a.id, nodeKey: a.nodeKey, kind: a.kind, title: a.title, reason: a.reason, data: a.data, status: a.status })),
    graph,
  };
}

/** Returns the raw run + nodes so the API can decide whether to nudge the runtime. */
export async function runNeedsDrive(runId: string) {
  const [run] = await db.select().from(arcRuns).where(eq(arcRuns.id, runId));
  if (!run) return false;
  const rns = await db.select().from(arcRunNodes).where(eq(arcRunNodes.arcRunId, runId));
  return ArcRuntime.needsDrive(run, rns);
}

export async function getArcDashboard(workspaceId: string) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [list, today, recent] = await Promise.all([
    db.select({ status: arcs.status }).from(arcs).where(and(eq(arcs.workspaceId, workspaceId), isNull(arcs.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(arcRuns).where(and(eq(arcRuns.workspaceId, workspaceId), gte(arcRuns.createdAt, start))),
    db.select({ run: arcRuns, name: arcs.name }).from(arcRuns).innerJoin(arcs, eq(arcs.id, arcRuns.arcId)).where(and(eq(arcRuns.workspaceId, workspaceId), isNull(arcs.deletedAt))).orderBy(desc(arcRuns.createdAt)).limit(6),
  ]);
  const counts = recent.length ? await db.select({ id: arcRunNodes.arcRunId, n: sql<number>`count(*)::int` }).from(arcRunNodes).where(and(inArray(arcRunNodes.arcRunId, recent.map((r) => r.run.id)), eq(arcRunNodes.nodeType, "machine"), notInArray(arcRunNodes.status, ["skipped", "pending"]))).groupBy(arcRunNodes.arcRunId) : [];
  return {
    activeArcs: list.filter((a) => a.status === "deployed" || a.status === "running").length,
    totalArcs: list.length,
    runsToday: today[0].n,
    recent: recent.map((r) => toRow(r.run, r.name, counts.find((c) => c.id === r.run.id)?.n ?? 0)),
  };
}
