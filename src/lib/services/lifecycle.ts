import { obs } from "@/lib/security/redact";

/** Drain work while maintaining leases. Forced shutdown leaves recovery to the database. */
export function installShutdown(service: string, stop: () => Promise<void>, timeoutMs: number) {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    obs("service.draining", { service });
    const timeout = setTimeout(() => {
      obs("service.shutdown_timeout", { service });
      process.exit(1);
    }, timeoutMs);
    void stop().then(() => { clearTimeout(timeout); process.exitCode = 0; })
      .catch(() => { obs("service.shutdown_failed", { service }); process.exit(1); });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
