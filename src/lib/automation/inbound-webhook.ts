import "server-only";
import { parseToken, tokenMatches } from "@/lib/automation/webhook-token";
import { rateLimit } from "@/lib/security/rate-limit";
import { redactString, obs } from "@/lib/security/redact";

export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
type Hook = { id: string; workspaceId: string; tokenHash: string; enabled: boolean; inputTemplate: string; targetType: string; targetId: string };
type Dependencies = {
  findHook(prefix: string): Promise<Hook | undefined>;
  enqueue(hook: Hook, input: string): Promise<string | null>;
  touch(id: string): Promise<unknown>;
  render(template: string, vars: Record<string, string>): string;
};
const deny = (status: number, error: string) => Response.json({ error }, { status });

async function defaultDependencies(): Promise<Dependencies> {
  const [{ eq }, { db }, { webhooks }, { enqueue }, { renderTemplate, touchWebhook }] = await Promise.all([
    import("drizzle-orm"), import("@/db"), import("@/db/schema"), import("@/lib/queue/queue"), import("@/lib/automation/triggers"),
  ]);
  return {
    findHook: async prefix => (await db.select().from(webhooks).where(eq(webhooks.tokenPrefix, prefix)))[0],
    enqueue: (hook, input) => enqueue("trigger.fire", { source: "webhook", sourceId: hook.id, targetType: hook.targetType, targetId: hook.targetId, input, depth: 0 }, { workspaceId: hook.workspaceId }),
    touch: touchWebhook,
    render: renderTemplate,
  };
}

/** Authenticate, bound the actual streamed bytes, and enqueue; execution belongs to the worker. */
export async function handleInboundWebhook(req: Request, token: string, dependencies?: Dependencies): Promise<Response> {
  const prefix = parseToken(token);
  if (!prefix) return deny(404, "not found");
  if (!rateLimit(`hook:${prefix}`, { max: 30, windowMs: 60_000 }).ok) return deny(429, "rate limited");
  const deps = dependencies ?? await defaultDependencies();
  const hook = await deps.findHook(prefix);
  if (!hook || !tokenMatches(token, hook.tokenHash)) return deny(404, "not found");
  if (!hook.enabled) return deny(409, "webhook disabled");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BODY_BYTES) return deny(413, "payload too large");

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = req.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_WEBHOOK_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          return deny(413, "payload too large");
        }
        chunks.push(value);
      }
    } catch {
      return deny(400, "invalid payload");
    } finally {
      reader.releaseLock();
    }
  }
  let body = Buffer.concat(chunks).toString("utf8");
  try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* Plain text is supported. */ }
  const job = await deps.enqueue(hook, deps.render(hook.inputTemplate, { body: redactString(body) }));
  // An accounting failure must not turn an accepted job into a failed request and invite a retry.
  await deps.touch(hook.id).catch(() => obs("webhook.touch_failed", { webhookId: hook.id, jobId: job }));
  obs("webhook.received", { webhookId: hook.id, jobId: job, workspaceId: hook.workspaceId });
  return Response.json({ accepted: true, job }, { status: 202 });
}
