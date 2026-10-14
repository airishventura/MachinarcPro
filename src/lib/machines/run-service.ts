import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { MachineRuntime, RuntimeError } from "@/lib/runtime/machine-runtime";
import { notifyWorkers } from "@/lib/queue/queue";
import { obs } from "@/lib/security/redact";

/** workspaceId comes from a trusted session. Run, task and queue driver commit together. */
export async function enqueueMachineRun(machineId: string, workspaceId: string, input: string) {
  const text = input.trim();
  if (text.length < 3 || text.length > 4000) throw new RuntimeError("Describe the task (3–4000 characters).");
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`trigger-target:machine:${machineId}`}, 0))`);
    const runtime = await MachineRuntime.load(machineId, workspaceId, tx);
    const created = await runtime.createRun(text, "operator", {}, tx);
    await tx.insert(jobs).values({ kind: "machine.execute", payload: { runId: created.run.id }, workspaceId, dedupeKey: `machine:${created.run.id}` });
    return created;
  });
  notifyWorkers();
  obs("run.queued", { runId: result.run.id, machineId, workspaceId });
  return result;
}
