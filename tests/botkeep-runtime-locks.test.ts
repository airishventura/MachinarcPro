import "./helpers/setup-test-database";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { arcs, arcRunNodes, arcRuns, machineRuns, machineTasks, workspaces } from "@/db/schema";
import { createMachine } from "@/lib/machines/service";
import { machineCode } from "@/lib/domain";
import { MachineRuntime, RuntimeLeaseLostError } from "@/lib/runtime/machine-runtime";
import { ArcRuntime } from "@/lib/arcs/runtime";
import { jobContext } from "@/lib/runtime/job-context";
import type { AIProvider, GenerateResponse } from "@/lib/ai/types";
import type { Graph } from "@/lib/arcs/graph";

let workspaceId = "";
before(async () => { workspaceId = (await db.insert(workspaces).values({ name: "BOTKEEP-RUNTIME-TEST" }).returning())[0].id; });
after(async () => {
  MachineRuntime.providerOverride = null;
  try { if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId)); }
  finally { await pool.end(); }
});

function provider(generate: AIProvider["generate"]): AIProvider {
  return { name: "mock", supportsToolCalling: () => true, normalizeUsage: usage => usage as never, calculateEstimatedCost: () => 0, generate };
}
const response = (): GenerateResponse => ({ content: "Persisted child output.", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, finishReason: "stop", providerMetadata: { provider: "mock", model: "mock-runtime", latencyMs: 0 } });
async function machine() {
  return createMachine(workspaceId, { name: "Runtime recovery", machineCode: machineCode("research"), objective: "Exercise durable worker recovery.", memoryMode: "none" }, "idle");
}
async function arcFixture(machineId: string, running = true) {
  const graph: Graph = {
    nodes: [
      { key: "trigger", type: "trigger", label: "Input", machineId: null, x: 0, y: 0, config: {} },
      { key: "machine", type: "machine", label: "Machine", machineId, x: 1, y: 0, config: {} },
      { key: "output", type: "output", label: "Output", machineId: null, x: 2, y: 0, config: {} },
    ],
    edges: [{ id: "a", source: "trigger", target: "machine", sourceHandle: null }, { id: "b", source: "machine", target: "output", sourceHandle: null }],
  };
  const [arc] = await db.insert(arcs).values({ workspaceId, name: "Recovery Arc", arcCode: `LOCK-${randomUUID()}`, status: "deployed" }).returning();
  const [run] = await db.insert(arcRuns).values({ workspaceId, arcId: arc.id, status: "running", triggerPayload: { input: "Recover input" }, graphSnapshot: graph, startedAt: new Date() }).returning();
  await db.insert(arcRunNodes).values([
    { arcRunId: run.id, nodeKey: "trigger", nodeType: "trigger", label: "Input", status: "completed", branch: "out", outputPayload: { text: "Recover input" } },
    { arcRunId: run.id, nodeKey: "machine", nodeType: "machine", label: "Machine", status: running ? "running" : "pending", startedAt: running ? new Date() : null },
    { arcRunId: run.id, nodeKey: "output", nodeType: "output", label: "Output" },
  ]);
  return run;
}

test("stale Machine driver cannot complete or release a replacement owner's lock", async () => {
  const m = await machine();
  const rt = await MachineRuntime.load(m.id, workspaceId);
  const { run } = await rt.createRun("Test replacement ownership", "test");
  const replacement = randomUUID();
  MachineRuntime.providerOverride = provider(async () => {
    await db.update(machineRuns).set({ lockOwner: replacement, lockUntil: new Date(Date.now() + 180_000) }).where(eq(machineRuns.id, run.id));
    return response();
  });
  await assert.rejects(rt.execute(run.id), RuntimeLeaseLostError);
  const [persisted] = await db.select().from(machineRuns).where(eq(machineRuns.id, run.id));
  const [task] = await db.select().from(machineTasks).where(eq(machineTasks.id, run.taskId));
  assert.equal(persisted.lockOwner, replacement);
  assert.ok(persisted.lockUntil);
  assert.equal(persisted.status, "running");
  assert.notEqual(task.status, "completed");
});

test("interrupted Arc consumes an existing completed child without creating another", async () => {
  const m = await machine();
  const rt = await MachineRuntime.load(m.id, workspaceId);
  const { task, run: child } = await rt.createRun("Persisted child", "test");
  await db.update(machineRuns).set({ status: "completed" }).where(eq(machineRuns.id, child.id));
  await db.update(machineTasks).set({ status: "completed", output: "Already completed once." }).where(eq(machineTasks.id, task.id));
  const arc = await arcFixture(m.id);
  await db.update(arcRunNodes).set({ machineRunId: child.id, machineTaskId: task.id, attempts: 1 }).where(and(eq(arcRunNodes.arcRunId, arc.id), eq(arcRunNodes.nodeKey, "machine")));
  MachineRuntime.providerOverride = provider(async () => { assert.fail("completed child must not be executed again"); });
  await ArcRuntime.drive(arc.id);
  const [done] = await db.select().from(arcRuns).where(eq(arcRuns.id, arc.id));
  assert.equal(done.status, "completed");
  assert.match(done.finalOutput ?? "", /Already completed once/);
  assert.equal((await db.select().from(machineRuns).where(eq(machineRuns.machineId, m.id))).length, 1);
});

test("interrupted unlinked Machine node fails explicitly without replay", async () => {
  const m = await machine();
  const arc = await arcFixture(m.id);
  await ArcRuntime.drive(arc.id);
  const [done] = await db.select().from(arcRuns).where(eq(arcRuns.id, arc.id));
  assert.equal(done.status, "failed");
  assert.match(done.errorMessage ?? "", /no durable child run is linked/);
  assert.equal((await db.select().from(machineRuns).where(eq(machineRuns.machineId, m.id))).length, 0);
});

test("new Arc child is durably associated before provider execution", async () => {
  const m = await machine();
  const arc = await arcFixture(m.id, false);
  MachineRuntime.providerOverride = provider(async () => {
    const nodes = await db.select().from(arcRunNodes).where(eq(arcRunNodes.arcRunId, arc.id));
    assert.ok(nodes.find(node => node.nodeKey === "machine")?.machineRunId);
    return response();
  });
  await ArcRuntime.drive(arc.id);
  const [done] = await db.select().from(arcRuns).where(eq(arcRuns.id, arc.id));
  assert.equal(done.status, "completed");
});

test("lost job lease prevents Arc from creating a child", async () => {
  const m = await machine();
  const arc = await arcFixture(m.id, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(jobContext.run({ jobId: randomUUID(), workerId: "test", attempt: 1, signal: controller.signal }, () => ArcRuntime.drive(arc.id)), RuntimeLeaseLostError);
  assert.equal((await db.select().from(machineRuns).where(eq(machineRuns.machineId, m.id))).length, 0);
});
