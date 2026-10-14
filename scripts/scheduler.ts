import "dotenv/config";
import { readServiceConfig } from "@/lib/services/config";
import { startServiceHttp } from "@/lib/services/http";
import { installShutdown } from "@/lib/services/lifecycle";
import { startWorkerLoop } from "@/lib/queue/worker-loop";
import { obs } from "@/lib/security/redact";

async function main() {
  const config = readServiceConfig("scheduler");
  process.env.TZ = "UTC";
  const { pool } = await import("@/db");
  const { tickSchedules } = await import("@/lib/automation/triggers");
  try {
    await pool.query("select 1");
    const http = await startServiceHttp({ service: "scheduler", port: config.port, host: config.host, ready: async () => { await pool.query("select 1"); return true; } });
    const loop = startWorkerLoop(async isStopped => {
      if (isStopped()) return;
      const scheduled = await tickSchedules();
      if (scheduled) obs("schedule.triggered", { count: scheduled });
    }, config.schedulerPollMs, () => obs("scheduler.poll_failed"));
    installShutdown("scheduler", async () => { await Promise.all([http.close(), loop.stopAndWait()]); await pool.end(); }, config.shutdownMs);
    obs("service.started", { service: "machinarc-scheduler", port: config.port });
  } catch (error) { await pool.end(); throw error; }
}
void main().catch(() => { obs("service.startup_failed", { service: "machinarc-scheduler" }); process.exitCode = 1; });
