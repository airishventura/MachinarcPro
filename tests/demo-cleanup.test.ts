import "./helpers/setup-test-database";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { activities, arcs, arcRuns, integrationCredentials, jobs, machineRuns, machines, machineTasks, sessions, users, workspaceIntegrations, workspaceMembers, workspaces } from "@/db/schema";
import { cleanupExpiredVisitorDemos } from "@/lib/seed/demo-cleanup";
import { DEMO_RETENTION_MS } from "@/lib/seed/demo-retention";

const now = new Date();
const old = new Date(now.getTime() - DEMO_RETENTION_MS - 86_400_000);
const workspaceIds: string[] = [], userIds: string[] = [];
async function fixture(options: { email?: string; passwordHash?: string; googleId?: string; demo?: boolean; userAge?: Date; workspaceAge?: Date } = {}) {
  const [user] = await db.insert(users).values({ email: options.email ?? `demo-${randomUUID()}@machinarc.invalid`, name: "Cleanup test visitor", passwordHash: options.passwordHash, googleId: options.googleId, createdAt: options.userAge ?? old }).returning();
  userIds.push(user.id);
  const [workspace] = await db.insert(workspaces).values({ name: "DEMO-CLEANUP-TEST", policy: { demo: options.demo ?? true }, createdAt: options.workspaceAge ?? old }).returning();
  workspaceIds.push(workspace.id);
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "owner" });
  return { user, workspace };
}

after(async () => {
  try {
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally { await pool.end(); }
});

test("expired isolated visitor profile, session, workspace and terminal data cascade together", async () => {
  const { user, workspace } = await fixture();
  const sessionId = randomUUID();
  await db.insert(sessions).values({ id: sessionId, userId: user.id, expiresAt: new Date(now.getTime() + 86_400_000) });
  const [machine] = await db.insert(machines).values({ workspaceId: workspace.id, name: "Terminal demo", machineCode: randomUUID(), status: "idle" }).returning();
  const [task] = await db.insert(machineTasks).values({ workspaceId: workspace.id, machineId: machine.id, number: 1, input: "test", status: "completed" }).returning();
  const [run] = await db.insert(machineRuns).values({ machineId: machine.id, taskId: task.id, status: "completed" }).returning();
  const [job] = await db.insert(jobs).values({ workspaceId: workspace.id, kind: "machine.execute", status: "completed", payload: { runId: run.id } }).returning();
  await db.insert(activities).values({ workspaceId: workspace.id, category: "system", actor: "test", message: "Cleanup fixture" });
  assert.equal(await cleanupExpiredVisitorDemos({ now, workspaceIds: [workspace.id] }), 1);
  assert.equal((await db.select().from(users).where(eq(users.id, user.id))).length, 0);
  assert.equal((await db.select().from(workspaces).where(eq(workspaces.id, workspace.id))).length, 0);
  assert.equal((await db.select().from(sessions).where(eq(sessions.id, sessionId))).length, 0);
  assert.equal((await db.select().from(machineRuns).where(eq(machineRuns.id, run.id))).length, 0);
  assert.equal((await db.select().from(jobs).where(eq(jobs.id, job.id))).length, 0);
  assert.equal(await cleanupExpiredVisitorDemos({ now, workspaceIds: [workspace.id] }), 0);
});

test("fresh, registered, Google, legacy seed, and non-demo identities are preserved", async () => {
  const fixtures = [];
  for (const options of [{ userAge: now }, { workspaceAge: now }, { passwordHash: "registered-test-hash" }, { googleId: "test-google-id" }, { email: `legacy-${randomUUID()}@example.test` }, { demo: false }]) fixtures.push(await fixture(options));
  assert.equal(await cleanupExpiredVisitorDemos({ now, workspaceIds: fixtures.map((item) => item.workspace.id) }), 0);
  for (const { user } of fixtures) assert.equal((await db.select().from(users).where(eq(users.id, user.id))).length, 1);
});

test("shared workspaces and visitors with other workspace memberships are preserved", async () => {
  const shared = await fixture(), linked = await fixture(), other = await fixture({ demo: false });
  await db.insert(workspaceMembers).values([{ workspaceId: shared.workspace.id, userId: other.user.id, role: "operator" }, { workspaceId: other.workspace.id, userId: linked.user.id, role: "viewer" }]);
  assert.equal(await cleanupExpiredVisitorDemos({ now, workspaceIds: [shared.workspace.id, linked.workspace.id] }), 0);
});

test("an imported provider credential protects the workspace and visitor identity", async () => {
  const { user, workspace } = await fixture();
  const [integration] = await db.insert(workspaceIntegrations).values({ workspaceId: workspace.id, kind: "ai_provider", slug: "openai", name: "Imported test integration" }).returning();
  await db.insert(integrationCredentials).values({ workspaceId: workspace.id, integrationId: integration.id, ciphertext: "test-ciphertext", iv: "test-iv", tag: "test-tag" });
  assert.equal(await cleanupExpiredVisitorDemos({ now, workspaceIds: [workspace.id] }), 0);
  assert.equal((await db.select().from(users).where(eq(users.id, user.id))).length, 1);
  assert.equal((await db.select().from(integrationCredentials).where(eq(integrationCredentials.workspaceId, workspace.id))).length, 1);
});

test("active jobs, deploying Machines, tasks, runs, and delayed Arcs are preserved", async () => {
  const fixtures = [];
  for (const kind of ["job", "machine", "task", "run", "arc"] as const) {
    const item = await fixture();
    fixtures.push(item);
    if (kind === "job") { await db.insert(jobs).values({ workspaceId: item.workspace.id, kind: "trigger.fire", status: "queued" }); continue; }
    if (kind === "arc") {
      const [arc] = await db.insert(arcs).values({ workspaceId: item.workspace.id, name: "Delayed demo", arcCode: randomUUID() }).returning();
      await db.insert(arcRuns).values({ workspaceId: item.workspace.id, arcId: arc.id, status: "waiting_delay", triggerPayload: { input: "test" }, graphSnapshot: { nodes: [], edges: [] } });
      continue;
    }
    const [machine] = await db.insert(machines).values({ workspaceId: item.workspace.id, name: "Active demo", machineCode: randomUUID(), status: kind === "machine" ? "initializing" : "idle" }).returning();
    if (kind !== "machine") {
      const [task] = await db.insert(machineTasks).values({ workspaceId: item.workspace.id, machineId: machine.id, number: 1, input: "test", status: kind === "task" ? "waiting_approval" : "completed" }).returning();
      if (kind === "run") await db.insert(machineRuns).values({ machineId: machine.id, taskId: task.id, status: "running" });
    }
  }
  assert.equal(await cleanupExpiredVisitorDemos({ now, workspaceIds: fixtures.map((item) => item.workspace.id) }), 0);
});

test("cleanup is bounded and concurrent invocations delete each visitor at most once", async () => {
  const fixtures = [await fixture(), await fixture(), await fixture()];
  const scope = fixtures.map((item) => item.workspace.id);
  const results = await Promise.all([cleanupExpiredVisitorDemos({ now, limit: 1, workspaceIds: scope }), cleanupExpiredVisitorDemos({ now, limit: 1, workspaceIds: scope })]);
  assert.ok(results.every((count) => count <= 1));
  const remaining = await db.select().from(workspaces).where(inArray(workspaces.id, scope));
  assert.equal(remaining.length, 3 - results.reduce((sum, count) => sum + count, 0));
  assert.ok(remaining.length >= 1);
  assert.equal(await cleanupExpiredVisitorDemos({ now, workspaceIds: scope }), remaining.length);
});
