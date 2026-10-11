// Run: npx tsx --conditions=react-server --test tests/trigger-idempotency.test.ts
import "./helpers/setup-test-database";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { arcRuns, jobs, machineRuns, machineTasks, machines, schedules, triggerFires, workspaces } from "@/db/schema";
import { fireTarget } from "@/lib/automation/triggers";
import { createMachine } from "@/lib/machines/service";
import { machineCode } from "@/lib/domain";
import { instantiateTemplate } from "@/lib/arcs/service";

let workspaceId = "";
before(async () => {
  [workspaceId] = (await db.insert(workspaces).values({ name: "TRIGGER-IDEMPOTENCY-TEST" }).returning()).map((workspace) => workspace.id);
});
after(async () => {
  try {
    if (workspaceId) {
      await db.delete(jobs).where(eq(jobs.workspaceId, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
  } finally { await pool.end(); }
});

const machine = () => createMachine(workspaceId, { name: "Trigger retry test", machineType: "research", machineCode: machineCode("research"), objective: "Exercise durable trigger retry behavior." }, "idle");

test("concurrent deliveries and replay after completion produce one Machine run and schedule count", async () => {
  const target = await machine();
  const [schedule] = await db.insert(schedules).values({ workspaceId, name: "Receipt test", targetType: "machine", targetId: target.id, kind: "interval", intervalSec: 3600, enabled: false }).returning();
  const params = { workspaceId, targetType: "machine", targetId: target.id, source: "schedule" as const, sourceId: schedule.id, input: "Run once", overlap: "queue" as const, jobId: randomUUID() };
  const [first, concurrent] = await Promise.all([fireTarget(params), fireTarget(params)]);
  assert.equal(first.status, "started");
  assert.deepEqual(concurrent, first);
  await db.update(machineRuns).set({ status: "completed" }).where(eq(machineRuns.machineId, target.id));
  await db.update(machines).set({ status: "idle" }).where(eq(machines.id, target.id));
  assert.deepEqual(await fireTarget(params), first);
  assert.equal((await db.select().from(machineTasks).where(eq(machineTasks.machineId, target.id))).length, 1);
  assert.equal((await db.select().from(machineRuns).where(eq(machineRuns.machineId, target.id))).length, 1);
  assert.equal((await db.select().from(triggerFires).where(eq(triggerFires.id, params.jobId))).length, 1);
  const [outcome] = await db.select().from(schedules).where(eq(schedules.id, schedule.id));
  assert.equal(outcome.runCount, 1);
  assert.equal(outcome.failCount, 0);
});

test("receipt failure rolls back Machine creation and a retry can safely start it", async () => {
  const target = await machine();
  const params = { workspaceId, targetType: "machine", targetId: target.id, source: "event" as const, input: "Run after rollback", overlap: "queue" as const, jobId: randomUUID() };
  const jobsBefore = (await db.select().from(jobs).where(eq(jobs.workspaceId, workspaceId))).length;
  // Invalid source UUID fails receipt insertion after task/run/driver creation.
  await assert.rejects(fireTarget({ ...params, sourceId: "invalid-uuid" }));
  assert.equal((await db.select().from(machineTasks).where(eq(machineTasks.machineId, target.id))).length, 0);
  assert.equal((await db.select().from(machineRuns).where(eq(machineRuns.machineId, target.id))).length, 0);
  assert.equal((await db.select().from(triggerFires).where(eq(triggerFires.id, params.jobId))).length, 0);
  assert.equal((await db.select().from(jobs).where(eq(jobs.workspaceId, workspaceId))).length, jobsBefore);
  const [unchanged] = await db.select().from(machines).where(eq(machines.id, target.id));
  assert.equal(unchanged.status, "idle");
  assert.equal((await fireTarget(params)).status, "started");
});

test("Arc receipt rollback and replay never duplicate its run or driver", async () => {
  const target = await instantiateTemplate(workspaceId, "emerging-tech", { status: "deployed" });
  const params = { workspaceId, targetType: "arc", targetId: target.id, source: "webhook" as const, input: "Create one Arc Run", jobId: randomUUID() };
  const jobsBefore = (await db.select().from(jobs).where(eq(jobs.workspaceId, workspaceId))).length;
  await assert.rejects(fireTarget({ ...params, sourceId: "invalid-uuid" }));
  assert.equal((await db.select().from(arcRuns).where(eq(arcRuns.arcId, target.id))).length, 0);
  assert.equal((await db.select().from(jobs).where(eq(jobs.workspaceId, workspaceId))).length, jobsBefore);
  const [first, replay] = await Promise.all([fireTarget(params), fireTarget(params)]);
  assert.equal(first.status, "started");
  assert.deepEqual(replay, first);
  await db.update(arcRuns).set({ status: "completed" }).where(eq(arcRuns.arcId, target.id));
  assert.deepEqual(await fireTarget(params), first);
  assert.equal((await db.select().from(arcRuns).where(eq(arcRuns.arcId, target.id))).length, 1);
  const drivers = await db.select().from(jobs).where(eq(jobs.dedupeKey, `arc:${first.ref}`));
  assert.equal(drivers.length, 1);
});
