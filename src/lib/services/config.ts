export type ServiceName = "worker" | "scheduler" | "integrations";

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name} (${min}–${max}).`);
  return value;
}

/** Validate private configuration before importing modules that connect to the database. */
export function readServiceConfig(service: ServiceName) {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
  } catch { throw new Error("DATABASE_URL must be a server-side PostgreSQL connection URL."); }
  if ((process.env.MARC_ENCRYPTION_KEY ?? "").length < 32) throw new Error("MARC_ENCRYPTION_KEY must have at least 32 characters.");
  if (process.env.VERCEL) throw new Error("Persistent services must run outside Vercel Functions.");
  const portName = process.env.SERVER_PORT !== undefined ? "SERVER_PORT" : "PORT";
  return {
    port: integer(portName, { worker: 3101, scheduler: 3102, integrations: 3103 }[service], 1, 65535),
    host: process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
    concurrency: integer("MACHINARC_WORKER_CONCURRENCY", Number(process.env.MARC_WORKER_CONCURRENCY ?? 2), 1, 16),
    pollMs: integer("MACHINARC_POLL_INTERVAL_MS", 3000, 500, 60_000),
    schedulerPollMs: integer("MACHINARC_SCHEDULER_POLL_INTERVAL_MS", 10_000, 1000, 60_000),
    leaseMs: integer("MACHINARC_JOB_LEASE_SECONDS", 120, 30, 3600) * 1000,
    shutdownMs: integer("MACHINARC_SHUTDOWN_TIMEOUT_MS", 30_000, 1000, 900_000),
  };
}
