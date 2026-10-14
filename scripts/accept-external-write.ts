// Staging-only probe: deterministic provider calls, real HTTP writes, no AI API.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (database.pathname !== "/machinarc_staging" || !["machinarc_staging", "machinarc_staging.eizxkonbtmkehwhsxdjw"].includes(database.username)) throw new Error("Requires the restricted staging database login");
  const mode = process.argv[2];
  if (mode !== "durable" && mode !== "ambiguous") throw new Error("Expected durable or ambiguous mode");
  const receiver = new URL(process.env.ACCEPTANCE_RECEIVER_URL ?? "");
  if (receiver.protocol !== "https:" || !receiver.hostname.endsWith(".vercel.run") || !process.env.ACCEPTANCE_RECEIVER_TOKEN) throw new Error("Requires the temporary HTTPS receiver and token");
  const [{ db, pool }, schema, { createMachine, draftDefaults }, { machineCode }, { MachineRuntime }, { setSecret }, queue, { processJob }] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/lib/machines/service"), import("@/lib/domain"),
    import("@/lib/runtime/machine-runtime"), import("@/lib/integrations/service"), import("@/lib/queue/queue"), import("@/lib/queue/worker"),
  ]);
  const workspace = (await db.insert(schema.workspaces).values({ name: `EXTERNAL-WRITE-${mode}` }).returning())[0];
  const integration = (await db.insert(schema.workspaceIntegrations).values({ workspaceId: workspace.id, kind: "custom_api", slug: "receipt_probe", name: "Temporary receipt receiver", status: "connected", config: {
    baseUrl: receiver.origin, allowedDomains: [receiver.hostname], authType: "bearer",
    actions: [{ name: "record", method: "POST", path: `/receipts/${mode}`, description: "Record a harmless acceptance receipt", params: [{ name: "mode", in: "body", type: "string", required: true }] }],
  } }).returning())[0];
  await setSecret(workspace.id, integration.id, process.env.ACCEPTANCE_RECEIVER_TOKEN!);
  const defaults = draftDefaults();
  const machine = await createMachine(workspace.id, {
    name: `External write probe ${mode}`, machineCode: machineCode("research"), objective: "Harmless real HTTP write acceptance", memoryMode: "none", maxRuntimeSec: 900,
    tools: [...defaults.tools.map(tool => ({ ...tool, enabled: false })), { id: "api__receipt_probe", enabled: true }],
    permissions: { ...defaults.permissions, network_write: "ASK" },
  }, "idle");
  // Non-mock name selects real tool execution; generate itself is a test stub.
  MachineRuntime.providerOverride = {
    name: "openai", supportsToolCalling: () => true, normalizeUsage: usage => usage as never, calculateEstimatedCost: () => 0,
    async generate(request) {
      const done = request.messages.some(message => message.role === "tool");
      return { content: done ? "Acceptance receipt recorded." : "Record one harmless receipt after approval.", toolCalls: done ? [] : [{ id: `receipt-${mode}`, name: "api__receipt_probe__record", args: { mode } }], usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, finishReason: done ? "stop" : "tool_calls", providerMetadata: { provider: "acceptance-scripted", model: "acceptance-scripted", latencyMs: 0 } };
    },
  };
  const runtime = await MachineRuntime.load(machine.id, workspace.id);
  const { run } = await runtime.createRun("Record one harmless HTTP receipt", "test", { allowBusy: true });
  const paused = await runtime.execute(run.id);
  if (paused.status !== "waiting_approval") throw new Error("Write did not pause for approval");
  const marker = { mode, workspaceId: workspace.id, machineId: machine.id, runId: run.id, approvalId: paused.approvalId };
  await mkdir(resolve(".validation"), { recursive: true });
  await writeFile(resolve(`.validation/external-${mode}.json`), JSON.stringify(marker));
  for (let attempt = 0; attempt < 60; attempt++) {
    const [approval] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, paused.approvalId));
    if (approval.status === "approved") break;
    if (attempt === 59) throw new Error("Approval was not supplied");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  // Publish the runnable state together with its claimed lease so the normal
  // cron cannot consume this test checkpoint before the probe driver does.
  const job = await db.transaction(async tx => {
    const [claimed] = await tx.insert(schema.jobs).values({ kind: "machine.execute", payload: { runId: run.id }, workspaceId: workspace.id, dedupeKey: `machine:${run.id}`, status: "running", lockedBy: `external-crash-${mode}`, lockedUntil: new Date(Date.now() + queue.LEASE_MS), attempts: 1, startedAt: new Date() }).returning();
    await tx.update(schema.machineRuns).set({ status: "running", lockUntil: null }).where(eq(schema.machineRuns.id, run.id));
    return claimed;
  });
  await writeFile(resolve(`.validation/external-${mode}.json`), JSON.stringify({ ...marker, jobId: job.id }));
  const originalQuery = pool.query;
  pool.query = (async (...args: unknown[]) => {
    const result = await Reflect.apply(originalQuery, pool, args);
    const config = args[0] as { text?: string; values?: unknown[] };
    const text = typeof args[0] === "string" ? args[0] : config.text ?? "";
    const values = (args[1] ?? config.values) as unknown[] | undefined;
    if (mode === "durable" && text.startsWith("update") && text.includes('"tool_executions"') && values?.[0] === "completed") {
      await writeFile(resolve(".validation/external-durable-committed.json"), JSON.stringify({ ...marker, jobId: job.id }));
      return new Promise(() => {});
    }
    return result;
  }) as typeof pool.query;
  await processJob(job, `external-crash-${mode}`);
  throw new Error("Probe completed without interruption");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Probe failed"); process.exit(1); });
