import "dotenv/config";
import { readServiceConfig } from "@/lib/services/config";
import { startServiceHttp } from "@/lib/services/http";
import { installShutdown } from "@/lib/services/lifecycle";
import { obs } from "@/lib/security/redact";

async function main() {
  const config = readServiceConfig("worker");
  process.env.TZ = "UTC";
  const { pool } = await import("@/db");
  const { startWorker } = await import("@/lib/queue/worker");
  try {
    await pool.query("select 1");
    const http = await startServiceHttp({ service: "worker", port: config.port, host: config.host, ready: async () => { await pool.query("select 1"); return true; } });
    const worker = startWorker({ mode: "botkeep", concurrency: config.concurrency, pollMs: config.pollMs, schedules: false });
    installShutdown("worker", async () => { await Promise.all([http.close(), worker.stop()]); await pool.end(); }, config.shutdownMs);
    obs("service.started", { service: "machinarc-worker", workerId: worker.id, port: config.port });
  } catch (error) { await pool.end(); throw error; }
}
void main().catch(() => { obs("service.startup_failed", { service: "machinarc-worker" }); process.exitCode = 1; });
