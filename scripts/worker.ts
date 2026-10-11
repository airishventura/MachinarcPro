// Dedicated worker process: npx tsx --conditions=react-server scripts/worker.ts
// Run any number of these alongside (or instead of) the in-process worker.
import "dotenv/config";
import { startWorker } from "@/lib/queue/worker";

const w = startWorker({ mode: "dedicated", concurrency: Number(process.env.MARC_WORKER_CONCURRENCY ?? 8) });
console.log(`[worker] ${w.id} started`);
const stop = () => { console.log("[worker] draining…"); w.stop(); setTimeout(() => process.exit(0), 1500); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
