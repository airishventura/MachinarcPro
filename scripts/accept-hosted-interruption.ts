// Staging-only crash probe. Run in a disposable hosted process, then SIGKILL it
// once .validation/interruption-<mode>.json exists. The normal cron resumes it.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/machinarc_staging" || !["machinarc_staging", "machinarc_staging.eizxkonbtmkehwhsxdjw"].includes(url.username)) throw new Error("Requires the restricted staging database login");
  const mode = process.argv[2];
  if (mode !== "durable" && mode !== "ambiguous") throw new Error("Expected durable or ambiguous mode");
  const [{ db, pool }, schema, { createMachine, draftDefaults }, { machineCode }, { MachineRuntime }, queue, { processJob }] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/lib/machines/service"), import("@/lib/domain"),
    import("@/lib/runtime/machine-runtime"), import("@/lib/queue/queue"), import("@/lib/queue/worker"),
  ]);
  const workspace = (await db.insert(schema.workspaces).values({ name: `HOSTED-INTERRUPTION-${mode}` }).returning())[0];
  const machine = await createMachine(workspace.id, {
    name: `Crash probe ${mode}`, machineCode: machineCode("research"), objective: "Harmless calculator crash acceptance", memoryMode: "none", maxRuntimeSec: 900,
    tools: draftDefaults().tools.map(tool => ({ ...tool, enabled: tool.id === "calculator" })),
  }, "idle");
  const runtime = await MachineRuntime.load(machine.id, workspace.id);
  const { run } = await runtime.createRun("[calc] Harmless hosted interruption acceptance", "test", { allowBusy: true });
  await queue.enqueue("machine.execute", { runId: run.id }, { workspaceId: workspace.id, dedupeKey: `machine:${run.id}` });
  const [job] = await queue.claim(`hosted-crash-${mode}`, 1, workspace.id);
  if (!job) throw new Error("Probe job was not claimed");

  const originalQuery = pool.query;
  // Pause only after PostgreSQL has committed the precise tool checkpoint.
  // SIGKILL prevents runtime finally/queue completion from releasing the leases.
  pool.query = (async (...args: unknown[]) => {
    const result = await Reflect.apply(originalQuery, pool, args);
    const config = args[0] as { text?: string; values?: unknown[] };
    const text = typeof args[0] === "string" ? args[0] : config.text ?? "";
    const values = (args[1] ?? config.values) as unknown[] | undefined;
    if (text.startsWith("update") && text.includes('"tool_executions"') && values?.[0] === (mode === "durable" ? "completed" : "running")) {
      const checkpoint = await Reflect.apply(originalQuery, pool, [
        "select id,status,output_payload,started_at,completed_at from tool_executions where machine_run_id=$1", [run.id],
      ]);
      await mkdir(resolve(".validation"), { recursive: true });
      await writeFile(resolve(`.validation/interruption-${mode}.json`), JSON.stringify({ mode, workspaceId: workspace.id, machineId: machine.id, runId: run.id, jobId: job.id, pid: process.pid, checkpointAt: new Date().toISOString(), tools: checkpoint.rows }));
      console.log(`Checkpoint committed: ${mode}`);
      return new Promise(() => {});
    }
    return result;
  }) as typeof pool.query;
  await processJob(job, `hosted-crash-${mode}`);
  throw new Error("Probe reached completion without interruption");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Probe failed"); process.exit(1); });
