// Run: npx tsx --conditions=react-server --test tests/phase4.test.ts
import "./helpers/setup-test-database";
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { arcRunNodes, arcRuns, eventTriggers, jobs, machineRuns, machines, machineTasks, profiles, schedules, triggerFires, webhooks, workspaceMembers, workspaces, integrationCredentials, workspaceIntegrations } from "@/db/schema";
import { nextCron, parseCron, describeSchedule } from "@/lib/automation/cron";
import { claim, completeJob, enqueue, failJob } from "@/lib/queue/queue";
import { drainOnce, recoverOrphans } from "@/lib/queue/worker";
import { computeNextRun, fireTarget, tickSchedules, MAX_TRIGGER_CHAIN } from "@/lib/automation/triggers";
import { mintWebhookToken } from "@/lib/automation/webhook-token";
import { createMachine } from "@/lib/machines/service";
import { machineCode } from "@/lib/domain";
import { instantiateTemplate, saveGraph } from "@/lib/arcs/service";
import { defaultNode } from "@/lib/arcs/graph";
import { POST as hookPOST } from "@/app/api/hooks/[token]/route";

let WS = "", WS2 = "";
const mk = (name: string, ws = WS) => createMachine(ws, { name, machineType: "research", machineCode: machineCode("research"), objective: "Automated test Machine objective." }, "idle");
async function drainUntil(pred: () => Promise<boolean>, ms = 30_000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { await drainOnce("test", 20, WS); if (await pred()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; }

before(async () => {
  process.env.MARC_OBS = "off";
  // Jobs are isolated by workspace; never erase the shared queue.
  WS = (await db.insert(workspaces).values({ name: "P4-TEST" }).returning())[0].id;
  WS2 = (await db.insert(workspaces).values({ name: "P4-OTHER" }).returning())[0].id;
});
after(async () => {
  try {
    if (WS) await db.delete(workspaces).where(eq(workspaces.id, WS));
    if (WS2) await db.delete(workspaces).where(eq(workspaces.id, WS2));
  } finally { await pool.end(); }
});

describe("cron", () => {
  test("parses and computes next fire times (UTC)", () => {
    const from = new Date("2026-03-02T08:59:30Z"); // Monday
    assert.equal(nextCron("0 9 * * 1-5", from).toISOString(), "2026-03-02T09:00:00.000Z");
    assert.equal(nextCron("*/15 * * * *", new Date("2026-03-02T10:07:00Z")).toISOString(), "2026-03-02T10:15:00.000Z");
    assert.equal(nextCron("0 0 1 * *", from).toISOString(), "2026-04-01T00:00:00.000Z");
    assert.equal(nextCron("30 6 * * 0", from).getUTCDay(), 0);
    for (const bad of ["* * * *", "61 * * * *", "* * * * 9", "a b c d e", "*/0 * * * *"]) assert.throws(() => parseCron(bad), bad);
    assert.equal(describeSchedule({ kind: "interval", intervalSec: 3600 }), "Every 1 h");
  });
});

describe("queue", () => {
  test("dedupe keys prevent duplicate execution", async () => {
    const a = await enqueue("arc.drive", { runId: "x" }, { workspaceId: WS, dedupeKey: `${WS}:t:dedupe` });
    const b = await enqueue("arc.drive", { runId: "x" }, { workspaceId: WS, dedupeKey: `${WS}:t:dedupe` });
    assert.ok(a); assert.equal(b, null);
    await db.delete(jobs).where(and(eq(jobs.workspaceId, WS), eq(jobs.dedupeKey, `${WS}:t:dedupe`)));
  });
  test("concurrent claims never return the same job (SKIP LOCKED)", async () => {
    for (let i = 0; i < 12; i++) await enqueue("arc.drive", { runId: `c${i}` }, { workspaceId: WS, dedupeKey: `${WS}:t:claim:${i}` });
    const [x, y, z] = await Promise.all([claim("w1", 5, WS), claim("w2", 5, WS), claim("w3", 5, WS)]);
    const ids = [...x, ...y, ...z].map((j) => j.id);
    assert.equal(ids.length, new Set(ids).size); assert.equal(ids.length, 12);
    await db.delete(jobs).where(eq(jobs.workspaceId, WS));
  });
  test("failed jobs back off, then dead-letter; expired leases are reclaimed", async () => {
    await enqueue("arc.drive", { runId: "f" }, { workspaceId: WS, dedupeKey: `${WS}:t:fail`, maxAttempts: 2 });
    let [j] = await claim("w", 1, WS);
    assert.equal(await failJob(j, "boom"), false);
    const [q] = await db.select().from(jobs).where(eq(jobs.id, j.id));
    assert.equal(q.status, "queued"); assert.ok(q.runAt.getTime() > Date.now() + 5000, "backoff applied");
    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, j.id));
    [j] = await claim("w", 1, WS);
    assert.equal(await failJob(j, "boom again"), true, "dead after maxAttempts");
    // lease expiry → reclaim (crashed worker)
    await enqueue("arc.drive", { runId: "l" }, { workspaceId: WS, dedupeKey: `${WS}:t:lease` });
    const [l] = await claim("crashed", 1, WS);
    await db.update(jobs).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(jobs.id, l.id));
    const [again] = await claim("rescuer", 1, WS);
    assert.equal(again.id, l.id); assert.equal(again.lockedBy, "rescuer"); assert.equal(again.attempts, 2);
    await completeJob(l);
    await failJob(l, "stale worker failure");
    const [owned] = await db.select().from(jobs).where(eq(jobs.id, l.id));
    assert.equal(owned.status, "running"); assert.equal(owned.lockedBy, "rescuer", "stale worker cannot complete or fail a reclaimed job");
    await completeJob(again);
    await db.delete(jobs).where(eq(jobs.workspaceId, WS));
  });
});

describe("schedules", () => {
  test("enqueue failure rolls back schedule advancement; retry enqueues exactly once", async () => {
    const m = await mk("SCHED-ROLLBACK");
    const nextRunAt = new Date(Date.now() - 1000);
    const [s] = await db.insert(schedules).values({ workspaceId: WS, name: "rollback", targetType: "machine", targetId: m.id, kind: "interval", intervalSec: 120, nextRunAt }).returning();
    const client = await pool.connect();
    const query = client.query.bind(client);
    const intercept = mock.method(client, "query", (...args: Parameters<typeof client.query>) => {
      if (typeof args[0] === "string" && args[0].startsWith("insert into jobs")) return Promise.reject(new Error("injected enqueue failure"));
      return query(...args);
    });
    const connect = mock.method(pool, "connect", async () => client);
    try { await assert.rejects(tickSchedules(25, WS), /injected enqueue failure/); }
    finally { intercept.mock.restore(); connect.mock.restore(); }
    const [unchanged] = await db.select().from(schedules).where(eq(schedules.id, s.id));
    assert.equal(unchanged.nextRunAt!.getTime(), nextRunAt.getTime());
    assert.equal(unchanged.lastRunAt, null);
    const dedupeKey = `sched:${s.id}:${nextRunAt.toISOString()}`;
    assert.equal((await db.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey))).length, 0);
    assert.equal(await tickSchedules(25, WS), 1);
    assert.equal(await tickSchedules(25, WS), 0);
    assert.equal((await db.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey))).length, 1);
    const [advanced] = await db.select().from(schedules).where(eq(schedules.id, s.id));
    const remainingMs = advanced.nextRunAt!.getTime() - Date.now();
    assert.ok(remainingMs > 100_000 && remainingMs <= 120_000, "next occurrence remains a 120s interval across host timezones");
    await db.delete(jobs).where(and(eq(jobs.workspaceId, WS), eq(jobs.dedupeKey, dedupeKey)));
    await db.delete(schedules).where(eq(schedules.id, s.id));
  });
  test("due schedule fires → Machine runs to completion on the worker; next run advances", async () => {
    const m = await mk("SCHED-01");
    const [s] = await db.insert(schedules).values({ workspaceId: WS, name: "t", targetType: "machine", targetId: m.id, kind: "interval", intervalSec: 120, input: "scheduled scan", nextRunAt: new Date(Date.now() - 1000) }).returning();
    assert.equal(await tickSchedules(25, WS), 1);
    assert.equal(await tickSchedules(25, WS), 0, "not re-fired in the same window");
    const [adv] = await db.select().from(schedules).where(eq(schedules.id, s.id));
    assert.ok(adv.nextRunAt!.getTime() > Date.now() + 100_000);
    const ok = await drainUntil(async () => (await db.select().from(machineTasks).where(and(eq(machineTasks.machineId, m.id), eq(machineTasks.status, "completed")))).length === 1);
    assert.ok(ok, "scheduled task completed");
    const [t] = await db.select().from(machineTasks).where(eq(machineTasks.machineId, m.id));
    assert.equal(t.source, "schedule");
    const [after1] = await db.select().from(schedules).where(eq(schedules.id, s.id));
    assert.equal(after1.runCount, 1); assert.equal(after1.lastStatus, "started");
  });
  test("overlap: skip while previous run active; paused Machines are skipped", async () => {
    const m = await mk("OVERLAP-01");
    const r1 = await fireTarget({ workspaceId: WS, targetType: "machine", targetId: m.id, input: "a", source: "schedule" });
    const r2 = await fireTarget({ workspaceId: WS, targetType: "machine", targetId: m.id, input: "b", source: "schedule" });
    assert.equal(r1.status, "started"); assert.equal(r2.status, "skipped");
    await db.update(machines).set({ status: "paused" }).where(eq(machines.id, m.id));
    assert.equal((await fireTarget({ workspaceId: WS, targetType: "machine", targetId: m.id, input: "c", source: "schedule", overlap: "queue" })).status, "skipped");
    await drainUntil(async () => true, 1);
  });
  test("cross-workspace targets are rejected; draft Arcs are skipped", async () => {
    const foreign = await mk("FOREIGN-01", WS2);
    assert.equal((await fireTarget({ workspaceId: WS, targetType: "machine", targetId: foreign.id, input: "x", source: "webhook" })).status, "failed");
    const arc = await instantiateTemplate(WS, "market-intelligence", { status: "draft" });
    const r = await fireTarget({ workspaceId: WS, targetType: "arc", targetId: arc.id, input: "x", source: "schedule" });
    assert.equal(r.status, "skipped"); assert.match(r.reason ?? "", /Deploy/);
  });
  test("computeNextRun enforces a 60s floor", () => { assert.ok(computeNextRun({ kind: "interval", intervalSec: 5, cron: null }).getTime() - Date.now() >= 59_000); });
});

describe("webhooks", () => {
  test("valid token → 202 + run; bad token 404; disabled 409; body secrets redacted", async () => {
    const m = await mk("HOOK-01");
    const { token, prefix, hash } = mintWebhookToken();
    const [h] = await db.insert(webhooks).values({ workspaceId: WS, name: "t", targetType: "machine", targetId: m.id, tokenPrefix: prefix, tokenHash: hash, inputTemplate: "Event:\n{{body}}" }).returning();
    const call = (t: string, body: unknown) => hookPOST(new Request(`http://x/api/hooks/${t}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ token: t }) });
    const ok = await call(token, { title: "issue", api_key: "sk-proj-abcdefghijklmnopqrstuvwx" });
    assert.equal(ok.status, 202);
    assert.equal((await call(token.slice(0, -2) + "zz", {})).status, 404);
    assert.equal((await call("whk_nope", {})).status, 404);
    const done = await drainUntil(async () => (await db.select().from(machineTasks).where(and(eq(machineTasks.machineId, m.id), eq(machineTasks.status, "completed")))).length === 1);
    assert.ok(done);
    const [t] = await db.select().from(machineTasks).where(eq(machineTasks.machineId, m.id));
    assert.equal(t.source, "webhook"); assert.ok(t.input.includes("issue")); assert.ok(!t.input.includes("sk-proj-abc"), "secret redacted from webhook body");
    await db.update(webhooks).set({ enabled: false }).where(eq(webhooks.id, h.id));
    assert.equal((await call(token, {})).status, 409);
  });
});

describe("event triggers", () => {
  test("A completes → B runs with A's output; chain depth is capped", async () => {
    const a = await mk("EVT-A"), b = await mk("EVT-B");
    await db.insert(eventTriggers).values({ workspaceId: WS, name: "a→b", sourceType: "machine", sourceId: a.id, onStatus: "completed", targetType: "machine", targetId: b.id, inputTemplate: "Follow up: {{output}}" });
    await fireTarget({ workspaceId: WS, targetType: "machine", targetId: a.id, input: "start", source: "webhook" });
    const ok = await drainUntil(async () => (await db.select().from(machineTasks).where(and(eq(machineTasks.machineId, b.id), eq(machineTasks.status, "completed")))).length === 1);
    assert.ok(ok, "B executed");
    const [bt] = await db.select().from(machineTasks).where(eq(machineTasks.machineId, b.id));
    assert.equal(bt.source, "event"); assert.equal(bt.triggerDepth, 1); assert.match(bt.input, /^Follow up: SUMMARY/);
    const r = await fireTarget({ workspaceId: WS, targetType: "machine", targetId: b.id, input: "x", source: "event", depth: MAX_TRIGGER_CHAIN + 1 });
    assert.equal(r.status, "skipped");
    const [f] = await db.select().from(triggerFires).where(and(eq(triggerFires.workspaceId, WS), eq(triggerFires.reason, `Trigger chain depth limit (${MAX_TRIGGER_CHAIN}) reached — possible loop.`)));
    assert.ok(f);
  });
});

describe("durability", () => {
  test("orphaned run (dead driver) is re-enqueued and resumes to completion", async () => {
    const m = await mk("ORPHAN-01");
    const { MachineRuntime } = await import("@/lib/runtime/machine-runtime");
    const rt = await MachineRuntime.load(m.id, WS);
    const { run } = await rt.createRun("orphaned work", "test", { allowBusy: true });
    await db.update(machineRuns).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(machineRuns.id, run.id)); // no job ever enqueued
    assert.ok((await recoverOrphans(WS)) >= 1);
    const ok = await drainUntil(async () => (await db.select().from(machineRuns).where(eq(machineRuns.id, run.id)))[0].status === "completed");
    assert.ok(ok);
  });
  test("Arc Delay node is scheduled as a future job (no in-memory timers)", async () => {
    const arc = await instantiateTemplate(WS, "market-intelligence", { status: "deployed" });
    const T = { ...defaultNode("trigger", 0, 0), key: "t" }, D = { ...defaultNode("delay", 1, 0), key: "d", config: { duration: 2, unit: "seconds" as const } }, O = { ...defaultNode("output", 2, 0), key: "o", config: { outputName: "X", template: "done" } };
    await saveGraph(arc.id, WS, { nodes: [T, D, O], edges: [{ id: "e1", source: "t", target: "d", sourceHandle: "out" }, { id: "e2", source: "d", target: "o", sourceHandle: "out" }] });
    const r = await fireTarget({ workspaceId: WS, targetType: "arc", targetId: arc.id, input: "go", source: "schedule" });
    assert.equal(r.status, "started");
    await drainOnce("test", 20, WS);
    const delayed = await db.select().from(jobs).where(eq(jobs.dedupeKey, `arc-delay:${r.ref}:d`));
    assert.equal(delayed.length, 1); assert.ok(delayed[0].runAt.getTime() > Date.now());
    const ok = await drainUntil(async () => (await db.select().from(arcRuns).where(eq(arcRuns.id, r.ref!)))[0].status === "completed", 15_000);
    assert.ok(ok, "Arc completed after delay");
    const [n] = await db.select().from(arcRunNodes).where(and(eq(arcRunNodes.arcRunId, r.ref!), eq(arcRunNodes.nodeKey, "d")));
    assert.equal(n.status, "completed");
  });
});

describe("RLS (Supabase policies)", () => {
  test("members see only their workspace; credentials are never readable; cross-tenant writes fail", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(readFileSync("supabase/rls.sql", "utf8"));
      const [ua] = (await c.query(`insert into profiles (email, name) values ('rls-a@x.io','A') returning id`)).rows;
      const [ub] = (await c.query(`insert into profiles (email, name) values ('rls-b@x.io','B') returning id`)).rows;
      await c.query(`insert into workspace_members (workspace_id, user_id) values ($1,$2),($3,$4)`, [WS, ua.id, WS2, ub.id]);
      const [integ] = (await c.query(`insert into workspace_integrations (workspace_id, kind, slug, name) values ($1,'ai_provider','rls-test','X') returning id`, [WS])).rows;
      await c.query(`insert into integration_credentials (workspace_id, integration_id, ciphertext, iv, tag) values ($1,$2,'c','i','t')`, [WS, integ.id]);
      await c.query(`create role marc_rls_probe nologin`);
      await c.query(`grant usage on schema public, auth to marc_rls_probe; grant select, insert, update, delete on all tables in schema public to marc_rls_probe; grant execute on all functions in schema public, auth to marc_rls_probe`);
      await c.query(`set local role marc_rls_probe`);
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ua.id]);
      const seen = (await c.query(`select distinct workspace_id from machines`)).rows.map((r) => r.workspace_id);
      assert.ok(seen.length >= 1 && seen.every((w) => w === WS), `A only sees own workspace (saw ${seen})`);
      assert.equal((await c.query(`select count(*)::int n from machines where workspace_id = $1`, [WS2])).rows[0].n, 0);
      assert.equal((await c.query(`select count(*)::int n from integration_credentials`)).rows[0].n, 0, "credentials never readable");
      assert.equal((await c.query(`select count(*)::int n from sessions`)).rows[0].n, 0);
      await c.query("savepoint s1");
      await assert.rejects(c.query(`insert into schedules (workspace_id, name, target_type, target_id, interval_sec, next_run_at) values ($1,'evil','machine',gen_random_uuid(),3600,now())`, [WS2]), /row-level security/);
      await c.query("rollback to savepoint s1");
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ub.id]);
      assert.equal((await c.query(`select count(*)::int n from machines where workspace_id = $1`, [WS])).rows[0].n, 0, "B cannot see A");
    } finally { await c.query("rollback"); c.release(); }
    void profiles; void workspaceMembers; void integrationCredentials; void workspaceIntegrations;
  });
});
