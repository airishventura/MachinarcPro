import "./helpers/setup-test-database";
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { jobs, machineRuns, machineTasks, machines, schedules, webhooks, workspaces } from "@/db/schema";
import { enqueueMachineRun } from "@/lib/machines/run-service";
import { createMachine } from "@/lib/machines/service";
import { machineCode } from "@/lib/domain";
import { claim, completeJob, enqueue, extendLease, failJob } from "@/lib/queue/queue";
import { HANDLERS, processJob, recoverOrphans, settleExhaustedRuns, startWorker } from "@/lib/queue/worker";
import { tickSchedules } from "@/lib/automation/triggers";
import { mintWebhookToken } from "@/lib/automation/webhook-token";
import { handleInboundWebhook } from "@/lib/automation/inbound-webhook";

let workspaceId = "", otherWorkspaceId = "";
const makeMachine = () => createMachine(workspaceId, { name: "BOTKEEP TEST", machineType: "research", machineCode: machineCode("research"), objective: "Verify durable execution with the mock provider." }, "idle");
before(async () => {
  process.env.MARC_OBS = "off";
  [workspaceId, otherWorkspaceId] = (await db.insert(workspaces).values([{ name: "BOTKEEP-QUEUE-TEST", policy: { demo: true } }, { name: "BOTKEEP-OTHER-TEST" }]).returning()).map(row => row.id);
});
after(async () => {
  try { for (const id of [workspaceId, otherWorkspaceId]) if (id) await db.delete(workspaces).where(eq(workspaces.id, id)); }
  finally { await pool.end(); }
});

test("authorized submission atomically enqueues and a worker completes a persisted run", async () => {
  const machine = await makeMachine();
  await assert.rejects(enqueueMachineRun(machine.id, otherWorkspaceId, "Run an isolated mock task"), /workspace/);
  assert.equal((await db.select().from(machineTasks).where(eq(machineTasks.machineId, machine.id))).length, 0);
  const { run } = await enqueueMachineRun(machine.id, workspaceId, "Run an isolated mock task");
  assert.equal(run.status, "queued");
  const [job] = await claim("botkeep-success", 1, workspaceId);
  assert.equal(job.payload.runId, run.id);
  assert.equal(await processJob(job, "botkeep-success"), true);
  const [finished] = await db.select().from(machineRuns).where(eq(machineRuns.id, run.id));
  const [driver] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  assert.equal(finished.status, "completed");
  assert.equal(driver.status, "completed");
  assert.ok(finished.endedAt);
});

test("concurrent workers claim distinct jobs; old attempts cannot renew or complete", async () => {
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(await enqueue("arc.drive", { runId: "queue-only-probe" }, { workspaceId }));
  const [a, b] = await Promise.all([claim("worker-a", 3, workspaceId), claim("worker-b", 3, workspaceId)]);
  assert.equal(new Set([...a, ...b].map(job => job.id)).size, 6);
  const stale = a[0];
  await db.update(jobs).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(jobs.id, stale.id));
  const [recovered] = await claim("worker-c", 1, workspaceId);
  assert.equal(recovered.id, stale.id);
  assert.equal(recovered.attempts, 2);
  assert.equal(await extendLease(stale.id, "worker-a", stale.attempts), false);
  await completeJob(stale);
  const [owned] = await db.select().from(jobs).where(eq(jobs.id, stale.id));
  assert.equal(owned.lockedBy, "worker-c");
  for (const id of ids) if (id) await db.delete(jobs).where(eq(jobs.id, id));
});

test("enqueue failure rolls back task, run and Machine state together", async () => {
  const machine = await makeMachine();
  const client = await pool.connect();
  const query = client.query.bind(client);
  const intercept = mock.method(client, "query", (...args: Parameters<typeof client.query>) => {
    const first = args[0] as unknown as string | { text?: string };
    const text = typeof first === "string" ? first : first?.text;
    if (text?.startsWith('insert into "jobs"')) return Promise.reject(new Error("injected enqueue rejection"));
    return query(...args);
  });
  const connect = mock.method(pool, "connect", async () => client);
  try { await assert.rejects(enqueueMachineRun(machine.id, workspaceId, "Rollback on queue failure"), error => (error as { cause?: Error }).cause?.message === "injected enqueue rejection"); }
  finally { intercept.mock.restore(); connect.mock.restore(); }
  assert.equal((await db.select().from(machineTasks).where(eq(machineTasks.machineId, machine.id))).length, 0);
  assert.equal((await db.select().from(machineRuns).where(eq(machineRuns.machineId, machine.id))).length, 0);
  const [unchanged] = await db.select().from(machines).where(eq(machines.id, machine.id));
  assert.equal(unchanged.status, "idle");
});

test("a live driver defers delivery without consuming its retry budget", async () => {
  const machine = await makeMachine();
  const { run } = await enqueueMachineRun(machine.id, workspaceId, "Wait for a live owner");
  const lockUntil = new Date(Date.now() + 60_000);
  await db.update(machineRuns).set({ lockUntil, lockOwner: "another-live-driver", status: "running" }).where(eq(machineRuns.id, run.id));
  const [job] = await claim("contending-worker", 1, workspaceId);
  assert.equal(await processJob(job, "contending-worker"), true);
  const [deferred] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  assert.equal(deferred.status, "queued");
  assert.equal(deferred.attempts, 0);
  assert.ok(deferred.runAt > lockUntil);
  await db.delete(jobs).where(eq(jobs.id, job.id));
});

test("failed delivery backs off and repeated crashes exhaust the budget without orphan reset", async () => {
  const machine = await makeMachine();
  const { run } = await enqueueMachineRun(machine.id, workspaceId, "Recover a run without replaying effects");
  const [first] = await claim("worker-first", 1, workspaceId);
  await db.update(jobs).set({ maxAttempts: 2 }).where(eq(jobs.id, first.id));
  first.maxAttempts = 2;
  assert.equal(await failJob(first, "temporary infrastructure failure"), false);
  const [retry] = await db.select().from(jobs).where(eq(jobs.id, first.id));
  assert.ok(retry.runAt.getTime() > Date.now() + 5000);
  await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, first.id));
  const [second] = await claim("worker-second", 1, workspaceId);
  await db.update(jobs).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(jobs.id, second.id));
  assert.deepEqual(await claim("worker-third", 1, workspaceId), []);
  const [dead] = await db.select().from(jobs).where(eq(jobs.id, first.id));
  assert.equal(dead.status, "dead");
  await recoverOrphans(workspaceId);
  const [failed] = await db.select().from(machineRuns).where(eq(machineRuns.id, run.id));
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorKind, "worker_retries_exhausted");
  assert.equal((await db.select().from(jobs).where(eq(jobs.dedupeKey, `machine:${run.id}`))).length, 1);
});

test("worker rejects a cross-workspace driver before Machine execution", async () => {
  const machine = await makeMachine();
  const { run } = await enqueueMachineRun(machine.id, workspaceId, "Do not execute in the wrong workspace");
  await db.update(jobs).set({ workspaceId: otherWorkspaceId, maxAttempts: 1 }).where(eq(jobs.dedupeKey, `machine:${run.id}`));
  const [job] = await claim("unauthorized-worker", 1, otherWorkspaceId);
  assert.equal(await processJob(job, "unauthorized-worker"), false);
  await settleExhaustedRuns(workspaceId);
  const [unchanged] = await db.select().from(machineRuns).where(eq(machineRuns.id, run.id));
  assert.equal(unchanged.status, "queued");
});

test("concurrent schedulers enqueue a due timezone schedule only once", async () => {
  const machine = await makeMachine();
  const [schedule] = await db.insert(schedules).values({ workspaceId, name: "BOTKEEP timezone", targetType: "machine", targetId: machine.id, kind: "cron", cron: "*/5 * * * *", timezone: "Asia/Jakarta", nextRunAt: new Date(Date.now() - 1000) }).returning();
  const fired = await Promise.all([tickSchedules(25, workspaceId), tickSchedules(25, workspaceId)]);
  assert.equal(fired[0] + fired[1], 1);
  assert.equal((await db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.kind, "trigger.fire")))).length, 1);
  const [advanced] = await db.select().from(schedules).where(eq(schedules.id, schedule.id));
  assert.ok(advanced.nextRunAt && advanced.nextRunAt > new Date());
});

test("the existing webhook authenticates and enqueues its Machine trigger", async () => {
  const machine = await makeMachine();
  const token = mintWebhookToken();
  await db.insert(webhooks).values({ workspaceId, name: "BOTKEEP hook", targetType: "machine", targetId: machine.id, tokenPrefix: token.prefix, tokenHash: token.hash });
  const response = await handleInboundWebhook(new Request("https://example.test/hooks", { method: "POST", body: '{"event":"test"}' }), token.token);
  assert.equal(response.status, 202);
  const accepted = await response.json();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, accepted.job));
  assert.equal(job.kind, "trigger.fire");
  assert.equal(job.workspaceId, workspaceId);
  assert.equal(job.payload.targetId, machine.id);
  const [stillIdle] = await db.select().from(machines).where(eq(machines.id, machine.id));
  assert.equal(stillIdle.status, "idle", "ingress never executes the Machine inline");
});

test("graceful worker shutdown drains in-flight jobs before resolving", { timeout: 10_000 }, async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const claimed = new Promise<void>(resolve => { started = resolve; });
  HANDLERS["botkeep.test.gated"] = async () => { started(); await gate; };
  await db.insert(jobs).values({ kind: "botkeep.test.gated", workspaceId, priority: 0 });
  const worker = startWorker({ mode: "test", concurrency: 1, pollMs: 60_000, schedules: false });
  try {
    await claimed;
    let drained = false;
    const shutdown = worker.stop().then(() => { drained = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drained, false);
    release();
    await shutdown;
    assert.equal(drained, true);
    const [finished] = await db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.kind, "botkeep.test.gated")));
    assert.equal(finished.status, "completed");
  } finally { release(); await worker.stop(); delete HANDLERS["botkeep.test.gated"]; }
});
