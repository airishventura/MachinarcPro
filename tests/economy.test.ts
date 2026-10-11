import "./helpers/setup-test-database";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { runUsage, transactions, workspaces } from "@/db/schema";
import { getEconomyState } from "@/lib/economy/queries";
import { MachineRuntime } from "@/lib/runtime/machine-runtime";
import { createMachine } from "@/lib/machines/service";
import { DEFAULT_PERMISSIONS } from "@/config/tools";

after(() => pool.end());

test("lifetime Credit totals exceed table limits, exclude incomplete transactions, and keep real USD costs separate", async () => {
  const [ws] = await db.insert(workspaces).values({ name: "ECONOMY-TEST" }).returning();
  const [other] = await db.insert(workspaces).values({ name: "ECONOMY-OTHER" }).returning();
  try {
    const m = await createMachine(ws.id, { name: "ECONOMY", objective: "Accounting acceptance test." }, "idle");
    const rt = await MachineRuntime.load(m.id, ws.id);
    const { run } = await rt.createRun("accounting fixture", "test");
    await db.insert(transactions).values([
      ...Array.from({ length: 105 }, () => ({ workspaceId: ws.id, fromName: "A", toName: "B", purpose: "fixture", amount: 2, direction: "in" })),
      { workspaceId: ws.id, fromName: "A", toName: "B", purpose: "fixture", amount: 10, direction: "out" },
      { workspaceId: ws.id, fromName: "A", toName: "B", purpose: "fixture", amount: 999, direction: "in", status: "pending" },
      { workspaceId: other.id, fromName: "A", toName: "B", purpose: "fixture", amount: 500, direction: "in" },
    ]);
    await db.insert(runUsage).values([
      { machineRunId: run.id, provider: "openai", model: "fixture", cost: 0.5 },
      { machineRunId: run.id, provider: "openai", model: "unpriced", cost: null },
      { machineRunId: run.id, provider: "mock", model: "mock-runtime", cost: 100 },
    ]);
    const state = await getEconomyState(ws.id);
    assert.equal(state.txs.length, 100);
    assert.deepEqual({ revenue: state.totals.revenue, spend: state.totals.spend, count: state.totals.count }, { revenue: 210, spend: 10, count: 106 });
    assert.ok(Math.abs(state.totals.avg - 220 / 106) < 1e-10);
    assert.equal(state.compute, 0.5);
    assert.equal(state.unknown, 1);
    assert.equal(state.usage.length, 2);
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, ws.id));
    await db.delete(workspaces).where(eq(workspaces.id, other.id));
  }
});

test("an approved catalog hire remains simulated and never writes transactions or debits Credits", async () => {
  const [ws] = await db.insert(workspaces).values({ name: "NETWORK-SIMULATION", credits: 50 }).returning();
  try {
    const m = await createMachine(ws.id, { name: "SIMULATION", objective: "Check catalog permissions.", permissions: { ...DEFAULT_PERMISSIONS, machine_call: "ALLOW", financial_action: "ALLOW" } }, "idle");
    const rt = await MachineRuntime.load(m.id, ws.id);
    const result = await rt.requestMachine("DEEP-SCOUT-88", "example hire", { skipApproval: true });
    assert.equal(result.status, "simulated");
    assert.equal((await db.select().from(transactions).where(eq(transactions.workspaceId, ws.id))).length, 0);
    assert.equal((await db.select().from(workspaces).where(eq(workspaces.id, ws.id)))[0].credits, 50);
  } finally { await db.delete(workspaces).where(eq(workspaces.id, ws.id)); }
});
