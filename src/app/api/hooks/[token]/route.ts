import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { enqueue } from "@/lib/queue/queue";
import { parseToken, tokenMatches } from "@/lib/automation/webhook-token";
import { renderTemplate, touchWebhook } from "@/lib/automation/triggers";
import { rateLimit } from "@/lib/security/rate-limit";
import { redactString } from "@/lib/security/redact";

export const dynamic = "force-dynamic";
const MAX_BODY = 64 * 1024;
const deny = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Public inbound webhook. Authenticated by an unguessable token; never executes synchronously. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const prefix = parseToken(token);
  if (!prefix) return deny(404, "not found");
  if (!rateLimit(`hook:${prefix}`, { max: 30, windowMs: 60_000 }).ok) return deny(429, "rate limited");
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.tokenPrefix, prefix));
  if (!hook || !tokenMatches(token, hook.tokenHash)) return deny(404, "not found");
  if (!hook.enabled) return deny(409, "webhook disabled");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return deny(413, "payload too large");
  const raw = (await req.text()).slice(0, MAX_BODY);
  let body = raw;
  try { body = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* plain text is fine */ }
  const input = renderTemplate(hook.inputTemplate, { body: redactString(body) });
  const job = await enqueue("trigger.fire", { source: "webhook", sourceId: hook.id, targetType: hook.targetType, targetId: hook.targetId, input, depth: 0 }, { workspaceId: hook.workspaceId });
  await touchWebhook(hook.id);
  return NextResponse.json({ accepted: true, job }, { status: 202 });
}
export function GET() { return deny(405, "use POST"); }
