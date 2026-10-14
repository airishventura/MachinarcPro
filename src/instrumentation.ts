/**
 * Boots the durable background worker inside the Next.js server process.
 * Disable with MARC_WORKER=off when running dedicated workers (`npx tsx --conditions=react-server scripts/worker.ts`).
 * Multiple processes are safe: jobs and schedules are claimed with FOR UPDATE SKIP LOCKED.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL) return; // Hosted jobs run through authenticated, bounded worker requests.
  if (process.env.MACHINARC_EXECUTION_MODE === "botkeep") return;
  if (process.env.MARC_WORKER === "off" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorker } = await import("@/lib/queue/worker");
  startWorker({ mode: "in-process" });
}
