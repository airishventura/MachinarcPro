import "server-only";

// Sliding-window limiter (per process). Keys are namespaced: e.g. "run:ws:<id>", "tool:http:<machine>".
// Architected so a shared store (Redis/Postgres) can replace the Map without changing call sites.
const hits = new Map<string, { times: number[]; windowMs: number }>();

export const LIMITS = {
  demoPerIp: { max: 3, windowMs: 60 * 60_000 },
  loginPerAccount: { max: 5, windowMs: 15 * 60_000 },
  loginPerIp: { max: 30, windowMs: 15 * 60_000 },
  runTaskPerWorkspace: { max: 30, windowMs: 60_000 },
  runTaskPerMachine: { max: 10, windowMs: 60_000 },
  httpToolPerMachine: { max: 30, windowMs: 60_000 },
  fetchToolPerMachine: { max: 60, windowMs: 60_000 },
  machineCallPerWorkspace: { max: 20, windowMs: 60_000 },
  approvalsPerWorkspace: { max: 40, windowMs: 60_000 },
  providerPerWorkspace: { max: 120, windowMs: 60_000 },
  integrationTest: { max: 10, windowMs: 60_000 },
} as const;

export function rateLimit(key: string, l: { max: number; windowMs: number }): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const arr = (hits.get(key)?.times ?? []).filter((t) => now - t < l.windowMs);
  if (arr.length >= l.max) { hits.set(key, { times: arr, windowMs: l.windowMs }); return { ok: false, retryAfterMs: l.windowMs - (now - arr[0]) }; }
  arr.push(now); hits.set(key, { times: arr, windowMs: l.windowMs });
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.times.some((t) => now - t < v.windowMs)) hits.delete(k);
  return { ok: true, retryAfterMs: 0 };
}
