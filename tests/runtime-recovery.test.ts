// Run with tsx --conditions=react-server --test tests/runtime-recovery.test.ts
import "./helpers/setup-test-database";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { approvalRequests, jobs, machineRuns, toolExecutions, workspaces } from "@/db/schema";
import { enqueue } from "@/lib/queue/queue";
import { MachineRuntime } from "@/lib/runtime/machine-runtime";
import { createMachine, draftDefaults } from "@/lib/machines/service";
import { machineCode } from "@/lib/domain";
import type { AIProvider, ChatMessage, GenerateRequest, ToolCall } from "@/lib/ai/types";

let workspaceId = "";
before(async () => { workspaceId = (await db.insert(workspaces).values({ name: "RECOVERY-TEST" }).returning())[0].id; });
after(async () => {
  MachineRuntime.providerOverride = null;
  try {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  } finally { await pool.end(); }
});

function provider(assertMessages: (req: GenerateRequest) => void): AIProvider {
  return {
    name: "mock", supportsToolCalling: () => true, normalizeUsage: (usage) => usage as never, calculateEstimatedCost: () => 0,
    async generate(req) {
      assertMessages(req);
      return { content: "Recovered task completed successfully.", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, finishReason: "stop", providerMetadata: { provider: "mock", model: "mock-runtime", latencyMs: 0 } };
    },
  };
}

async function fixture(calls: ToolCall[]) {
  const machine = await createMachine(workspaceId, {
    name: "Recovery Machine", machineCode: machineCode("research"), objective: "Recover durable calls without repeating actions.", memoryMode: "none",
    tools: draftDefaults().tools.map((tool) => ({ ...tool, enabled: ["calculator", "request_approval"].includes(tool.id) })),
  }, "idle");
  const runtime = await MachineRuntime.load(machine.id, workspaceId);
  const { run } = await runtime.createRun("Recover these persisted calls", "test", { allowBusy: true });
  const messages: ChatMessage[] = [{ role: "user", content: "task" }, { role: "assistant", content: "plan", toolCalls: calls }];
  await db.update(machineRuns).set({ messages, status: "running", turns: 1, startedAt: new Date() }).where(eq(machineRuns.id, run.id));
  return { machine, runtime, run };
}

const calculator: ToolCall = { id: "calc", name: "calculator", args: { expression: "1 + 1" } };

test("UI recovery preserves an approved run queued between hosted worker ticks", async () => {
  const { machine, run } = await fixture([calculator]);
  await db.update(machineRuns).set({ createdAt: new Date(Date.now() - 240_000), lockUntil: null }).where(eq(machineRuns.id, run.id));
  await enqueue("machine.execute", { runId: run.id }, { workspaceId, dedupeKey: `machine:${run.id}` });
  await MachineRuntime.reapStale(machine.id);
  const [persisted] = await db.select().from(machineRuns).where(eq(machineRuns.id, run.id));
  assert.equal(persisted.status, "running");
  const queued = await db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.dedupeKey, `machine:${run.id}`)));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].status, "queued");
});

test("UI recovery requeues a vanished driver instead of terminating recoverable work", async () => {
  const { machine, runtime, run } = await fixture([calculator]);
  await db.update(machineRuns).set({ createdAt: new Date(Date.now() - 240_000), lockUntil: new Date(Date.now() - 1_000) }).where(eq(machineRuns.id, run.id));
  await MachineRuntime.reapStale(machine.id);
  const [persisted] = await db.select().from(machineRuns).where(eq(machineRuns.id, run.id));
  assert.equal(persisted.status, "running");
  const queued = await db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.dedupeKey, `machine:${run.id}`)));
  assert.equal(queued.length, 1);
  MachineRuntime.providerOverride = provider(req => assert.ok(req.messages.some(message => message.role === "tool" && message.toolCallId === calculator.id)));
  assert.equal((await runtime.execute(run.id)).status, "completed");
});

test("a persisted assistant call without an execution is answered before the provider continues", async () => {
  const { runtime, run } = await fixture([calculator]);
  MachineRuntime.providerOverride = provider((req) => assert.ok(req.messages.some((message) => message.role === "tool" && message.toolCallId === calculator.id)));
  assert.equal((await runtime.execute(run.id)).status, "completed");
});

test("a completed execution is restored without executing the original unavailable tool", async () => {
  const call = { id: "write", name: "disabled_write", args: {} };
  const { machine, runtime, run } = await fixture([call]);
  await db.insert(toolExecutions).values({ workspaceId, machineId: machine.id, machineRunId: run.id, toolCallId: call.id, toolId: call.name, status: "completed", outputPayload: { receipt: "already-performed" }, estimatedCost: 0.25 });
  MachineRuntime.providerOverride = provider((req) => assert.ok(req.messages.some((message) => message.role === "tool" && message.content.includes("already-performed"))));
  const outcome = await runtime.execute(run.id);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.cost, 0.25);
});

test("an interrupted in-flight action fails without replay or another provider request", async () => {
  const { machine, runtime, run } = await fixture([calculator]);
  await db.insert(toolExecutions).values({ workspaceId, machineId: machine.id, machineRunId: run.id, toolCallId: calculator.id, toolId: calculator.name, status: "running" });
  MachineRuntime.providerOverride = provider(() => assert.fail("provider must not continue after an unknown tool outcome"));
  const outcome = await runtime.execute(run.id);
  assert.equal(outcome.status, "failed");
  const [persisted] = await db.select().from(machineRuns).where(eq(machineRuns.id, run.id));
  assert.equal(persisted.errorKind, "tool_outcome_unknown");
});

test("approval recovery executes the approved call and its queued sibling before continuing", async () => {
  const approved: ToolCall = { id: "approval", name: "request_approval", args: { question: "Continue?" } };
  const { machine, runtime, run } = await fixture([approved, calculator]);
  const [execution] = await db.insert(toolExecutions).values({ workspaceId, machineId: machine.id, machineRunId: run.id, toolCallId: approved.id, toolId: approved.name, status: "waiting_approval" }).returning();
  await db.insert(approvalRequests).values({ workspaceId, machineId: machine.id, machineRunId: run.id, toolExecutionId: execution.id, toolId: approved.name, permission: "operator_confirmation", risk: "low", title: "Continue?", status: "approved", decision: "approve_once" });
  await db.update(machineRuns).set({ pendingToolCall: { ...approved, queue: [calculator] } as typeof run.pendingToolCall }).where(eq(machineRuns.id, run.id));
  MachineRuntime.providerOverride = provider((req) => assert.deepEqual(req.messages.flatMap((message) => message.role === "tool" ? [message.toolCallId] : []), [approved.id, calculator.id]));
  assert.equal((await runtime.execute(run.id)).status, "completed");
  const [persisted] = await db.select().from(machineRuns).where(eq(machineRuns.id, run.id));
  assert.equal(persisted.pendingToolCall, null);
});

test("long approval waits survive restart while cumulative active time still enforces the deadline", async () => {
  const approved: ToolCall = { id: "long-approval", name: "request_approval", args: { question: "Continue after the wait?" } };
  const { machine, runtime, run } = await fixture([approved, calculator]);
  const now = Date.now();
  await db.update(machineRuns).set({ startedAt: new Date(now - 3_600_000), pendingToolCall: approved }).where(eq(machineRuns.id, run.id));
  const [execution] = await db.insert(toolExecutions).values({ workspaceId, machineId: machine.id, machineRunId: run.id, toolCallId: approved.id, toolId: approved.name, status: "waiting_approval" }).returning();
  await db.insert(approvalRequests).values({ workspaceId, machineId: machine.id, machineRunId: run.id, toolExecutionId: execution.id, toolId: approved.name, permission: "operator_confirmation", risk: "low", title: "Continue?", status: "approved", decision: "approve_once", createdAt: new Date(now - 3_570_000), decidedAt: new Date(now - 10_000) });
  MachineRuntime.providerOverride = provider((req) => assert.deepEqual(req.messages.flatMap((message) => message.role === "tool" ? [message.toolCallId] : []), [approved.id, calculator.id]));
  assert.equal((await runtime.execute(run.id)).status, "completed");

  const expired = await fixture([calculator]);
  await db.update(machineRuns).set({ startedAt: new Date(now - 3_600_000) }).where(eq(machineRuns.id, expired.run.id));
  await db.insert(approvalRequests).values({ workspaceId, machineId: expired.machine.id, machineRunId: expired.run.id, toolId: "request_approval", permission: "operator_confirmation", risk: "low", title: "Past approval", status: "approved", createdAt: new Date(now - 3_300_000), decidedAt: new Date(now - 10_000) });
  MachineRuntime.providerOverride = provider(() => assert.fail("active runtime above 180 seconds must time out"));
  assert.equal((await expired.runtime.execute(expired.run.id)).status, "timeout");
});
