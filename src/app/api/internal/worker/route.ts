import { randomUUID, timingSafeEqual } from "node:crypto";
import { drainOnce, recoverOrphans } from "@/lib/queue/worker";
import { tickSchedules } from "@/lib/automation/triggers";
import { obs } from "@/lib/security/redact";
import { maybeCleanupVisitorDemos } from "@/lib/seed/demo-cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Invoke from a trusted scheduler; never run an unbounded polling loop in a Function. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // During Botkeep cutover, old cron deliveries remain authenticated but cannot execute runs on Vercel.
  if (process.env.MACHINARC_EXECUTION_MODE === "botkeep") return Response.json({ ok: true, mode: "botkeep", claimed: 0 });
  try {
    const scheduled = await tickSchedules();
    const recovered = await recoverOrphans();
    const claimed = await drainOnce(`http:${randomUUID()}`, 4);
    const cleanedDemos = await maybeCleanupVisitorDemos();
    return Response.json({ ok: true, scheduled, recovered, claimed, cleanedDemos });
  } catch (error) {
    obs("worker.request_error", { error: String(error) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
