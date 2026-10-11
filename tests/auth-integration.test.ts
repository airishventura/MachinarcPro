// Run against a disposable DB: npx tsx --conditions=react-server --test tests/auth-integration.test.ts
import "./helpers/setup-test-database";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { integrationCredentials, schedules, users, workspaceMembers, workspaces } from "@/db/schema";
import { provisionVisitorDemo } from "@/lib/seed/demo";
import { ensureIntegration, getSecret, providerConfigured, resolveProvider, setSecret } from "@/lib/integrations/service";

const userIds: string[] = [];
const workspaceIds: string[] = [];

before(async () => {
  for (let i = 0; i < 2; i++) {
    const userId = await provisionVisitorDemo();
    userIds.push(userId);
    const [member] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
    assert.ok(member);
    workspaceIds.push(member.workspaceId);
  }
});

after(async () => {
  try {
    // Resolve memberships as well, so a failed setup lookup cannot strand its fixture.
    for (const userId of userIds) {
      const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
      for (const member of members) await db.delete(workspaces).where(eq(workspaces.id, member.workspaceId));
      await db.delete(users).where(eq(users.id, userId));
    }
  } finally {
    await pool.end();
  }
});

test("each visitor has a distinct credential-free demo workspace with disabled initial schedules", async () => {
  assert.notEqual(userIds[0], userIds[1]);
  assert.notEqual(workspaceIds[0], workspaceIds[1]);
  for (let i = 0; i < 2; i++) {
    const [user] = await db.select().from(users).where(eq(users.id, userIds[i]));
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceIds[i]));
    assert.equal(user.passwordHash, null);
    assert.equal(workspace.policy.demo, true);
    const initialSchedules = await db.select().from(schedules).where(eq(schedules.workspaceId, workspace.id));
    assert.ok(initialSchedules.length > 0);
    assert.ok(initialSchedules.every((schedule) => !schedule.enabled));
    const credentials = await db.select().from(integrationCredentials).where(eq(integrationCredentials.workspaceId, workspace.id));
    assert.equal(credentials.length, 0);
  }
});

test("demo provider resolution ignores platform credentials and always selects mock", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "dummy-test-key-never-send-to-provider";
  try {
    const resolved = await resolveProvider(workspaceIds[0], "openai");
    assert.equal(resolved.provider.name, "mock");
    assert.equal(resolved.mode, "mock");
    assert.equal(resolved.fallback, true);
    assert.deepEqual(resolved.secrets, []);
    assert.equal(await providerConfigured(workspaceIds[0], "openai"), null);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("demo credentials cannot be saved or read even when a credential row exists", async () => {
  const workspaceId = workspaceIds[1];
  const integration = await ensureIntegration(workspaceId, "openai", "ai_provider", "OpenAI");
  await assert.rejects(setSecret(workspaceId, integration.id, "dummy-test-secret"), /Demo workspaces cannot store credentials/);
  const rows = await db.select().from(integrationCredentials).where(eq(integrationCredentials.workspaceId, workspaceId));
  assert.equal(rows.length, 0);
  assert.equal(await getSecret(workspaceId, integration.id), null);
  // A legacy/imported credential must also be shielded before decryption is attempted.
  await db.insert(integrationCredentials).values({ workspaceId, integrationId: integration.id, ciphertext: "invalid-test-ciphertext", iv: "invalid-test-iv", tag: "invalid-test-tag" });
  assert.equal(await getSecret(workspaceId, integration.id), null);
});
