import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, approvalRequests, machineLogs, machineRuns, machines, machineTasks, runSources, toolExecutions, usageRecords } from "@/db/schema";
import { MachineRuntime } from "@/lib/runtime/machine-runtime";
import { PERSISTABLE } from "@/lib/runtime/permissions";
import type { ApprovalDTO, LogDTO, MachineStateDTO, RunDTO, TaskDTO, ToolExecDTO } from "@/types/machine";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const toTask = (t: typeof machineTasks.$inferSelect): TaskDTO => ({ id: t.id, number: t.number, input: t.input, output: t.output, status: t.status, cost: t.cost, tokens: t.tokens, durationMs: t.durationMs, createdAt: t.createdAt.toISOString(), startedAt: iso(t.startedAt), completedAt: iso(t.completedAt), result: t.result ?? null, source: t.source });
const toLog = (l: typeof machineLogs.$inferSelect): LogDTO => ({ id: l.id, level: l.level, message: l.message, createdAt: l.createdAt.toISOString(), toolExecutionId: l.toolExecutionId });
const toRun = (r: typeof machineRuns.$inferSelect, sourcesCount = 0): RunDTO => ({ id: r.id, taskId: r.taskId, status: r.status, provider: r.provider, model: r.model, turns: r.turns, toolCalls: r.toolCalls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cost: r.cost, aiCost: r.aiCost, toolCost: r.toolCost, childCost: r.childCost, pricingKnown: r.pricingKnown, memoryCount: r.memoryIds?.length ?? 0, sourcesCount, depth: r.depth, error: r.error, errorKind: r.errorKind, cancelRequested: r.cancelRequested, startedAt: iso(r.startedAt) });
export const toToolExec = (t: typeof toolExecutions.$inferSelect): ToolExecDTO => ({ id: t.id, toolId: t.toolId, status: t.status, summary: t.summary, permission: t.permission, permissionDecision: t.permissionDecision, risk: t.risk, input: t.inputPayload, output: t.outputPayload, outputPreview: t.outputPreview, error: t.error, simulated: t.simulated, startedAt: iso(t.startedAt), durationMs: t.durationMs, createdAt: t.createdAt.toISOString() });
export const toApproval = (a: typeof approvalRequests.$inferSelect): ApprovalDTO => ({ id: a.id, toolId: a.toolId, permission: a.permission, risk: a.risk, title: a.title, destination: a.destination, purpose: a.purpose, payloadSummary: a.payloadSummary, status: a.status, decision: a.decision, createdAt: a.createdAt.toISOString(), persistable: a.kind === "tool" && PERSISTABLE.includes(a.permission as never), kind: a.kind });

export async function listMachines(workspaceId: string) {
  return db.select().from(machines).where(eq(machines.workspaceId, workspaceId)).orderBy(desc(machines.lastActiveAt));
}

export async function getDashboard(workspaceId: string) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const [ms, acts, spend, running] = await Promise.all([
    listMachines(workspaceId),
    db.select().from(activities).where(eq(activities.workspaceId, workspaceId)).orderBy(desc(activities.createdAt)).limit(14),
    db.select({ v: sql<number>`coalesce(sum(${usageRecords.cost}),0)::float` }).from(usageRecords).where(and(eq(usageRecords.workspaceId, workspaceId), gte(usageRecords.createdAt, startOfDay))),
    db.select({ n: sql<number>`count(*)::int` }).from(machineTasks).where(and(eq(machineTasks.workspaceId, workspaceId), inArray(machineTasks.status, ["queued", "initializing", "running", "waiting_tool", "waiting_approval"]))),
  ]);
  const finished = ms.reduce((a, m) => a + m.tasksCompleted, 0);
  const ok = ms.reduce((a, m) => a + m.successfulTasks, 0);
  return {
    machines: ms, activities: acts,
    metrics: {
      online: ms.filter((m) => m.status === "running" || m.status === "idle").length,
      total: ms.length,
      running: running[0].n,
      completed: finished,
      successRate: finished ? (ok / finished) * 100 : null,
      spendToday: spend[0].v,
      dailyBudget: ms.reduce((a, m) => a + m.dailyBudget, 0),
    },
  };
}

export async function getMachineDetail(id: string, workspaceId: string, taskId?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [m] = await db.select().from(machines).where(and(eq(machines.id, id), eq(machines.workspaceId, workspaceId)));
  if (!m) return null;
  const tasks = await db.select().from(machineTasks).where(eq(machineTasks.machineId, id)).orderBy(desc(machineTasks.createdAt)).limit(50);
  const state = await getMachineState(id, workspaceId, taskId && tasks.some((t) => t.id === taskId) ? taskId : tasks[0]?.id);
  return { machine: m, tasks: tasks.map(toTask), state };
}

/** Live state for a Machine; scoped to one task when taskId is supplied. */
export async function getMachineState(id: string, workspaceId: string, taskId?: string | null): Promise<MachineStateDTO | null> {
  const [m0] = await db.select({ id: machines.id }).from(machines).where(and(eq(machines.id, id), eq(machines.workspaceId, workspaceId)));
  if (!m0) return null;
  await MachineRuntime.reapStale(id);
  const [m] = await db.select().from(machines).where(eq(machines.id, id));
  let task: TaskDTO | null = null, run: RunDTO | null = null, logs: LogDTO[], tools: ToolExecDTO[] = [], approval: ApprovalDTO | null = null;
  if (taskId) {
    const [t] = await db.select().from(machineTasks).where(and(eq(machineTasks.id, taskId), eq(machineTasks.machineId, id)));
    if (t) {
      task = toTask(t);
      const [r] = await db.select().from(machineRuns).where(eq(machineRuns.taskId, t.id)).orderBy(desc(machineRuns.createdAt)).limit(1);
      if (r) {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(runSources).where(eq(runSources.machineRunId, r.id));
        run = toRun(r, n);
        tools = (await db.select().from(toolExecutions).where(eq(toolExecutions.machineRunId, r.id)).orderBy(toolExecutions.createdAt)).map(toToolExec);
        const [ap] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.machineRunId, r.id), eq(approvalRequests.status, "pending"))).limit(1);
        approval = ap ? toApproval(ap) : null;
      }
    }
  }
  if (run) logs = (await db.select().from(machineLogs).where(eq(machineLogs.runId, run.id)).orderBy(machineLogs.createdAt)).map(toLog);
  else logs = (await db.select().from(machineLogs).where(eq(machineLogs.machineId, id)).orderBy(desc(machineLogs.createdAt)).limit(60)).reverse().map(toLog);
  return { machine: { status: m.status, currentTask: m.currentTask, tasksCompleted: m.tasksCompleted, successRate: m.successRate, totalCost: m.totalCost, totalRuntimeMs: m.totalRuntimeMs }, task, run, logs, tools, approval };
}

/** Pending tool authorizations across the workspace (Command Center). */
export async function pendingToolApprovals(workspaceId: string) {
  return db.select({ a: approvalRequests, machineName: machines.name, machineId: machines.id }).from(approvalRequests).innerJoin(machines, eq(machines.id, approvalRequests.machineId)).where(and(eq(approvalRequests.workspaceId, workspaceId), eq(approvalRequests.status, "pending"))).orderBy(desc(approvalRequests.createdAt)).limit(10);
}
