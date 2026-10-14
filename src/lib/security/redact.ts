import { getJobContext } from "@/lib/runtime/job-context";

// Centralized secret redaction for logs, tool payloads and telemetry.
const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|token|secret|client[-_]?secret|password|passwd|pwd|private[-_]?key|session)$/i;
const PATTERNS: RegExp[] = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g,         // OpenAI / Anthropic keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,                    // GitHub tokens
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,                   // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                              // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /([?&](?:api[_-]?key|key|token|access_token|secret|password)=)[^&\s]+/gi,
];

export function redactString(s: string, extraSecrets: string[] = []): string {
  let out = s;
  for (const sec of extraSecrets) if (sec && sec.length >= 6) out = out.split(sec).join("[REDACTED]");
  for (const p of PATTERNS) out = out.replace(p, (m, g1) => (typeof g1 === "string" && m.startsWith(g1) ? `${g1}[REDACTED]` : "[REDACTED]"));
  return out;
}

/** Database errors may contain SQL parameter payloads; never put those into service logs. */
export function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/^Failed query:|(?:^|\n)params:/i.test(message)) return "Database operation failed.";
  return redactString(message).slice(0, 1000);
}

export function redact<T>(v: T, extraSecrets: string[] = [], depth = 0): T {
  if (depth > 8) return "[TRUNCATED]" as unknown as T;
  if (typeof v === "string") return redactString(v, extraSecrets) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => redact(x, extraSecrets, depth + 1)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(val, extraSecrets, depth + 1);
    return o as T;
  }
  return v;
}

/** Structured internal observability log. Always redacted. */
export function obs(event: string, fields: Record<string, unknown> = {}) {
  if (process.env.MARC_OBS === "off") return;
  const context = getJobContext();
  const execution = context ? { jobId: context.jobId, workerId: context.workerId, attempt: context.attempt, runId: context.runId, machineId: context.machineId } : {};
  try { console.log(JSON.stringify({ t: new Date().toISOString(), event, ...execution, ...redact(fields) })); } catch { /* never throw from logging */ }
}
