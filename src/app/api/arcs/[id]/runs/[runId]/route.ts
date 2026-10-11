import { NextResponse } from "next/server";
import { enqueue } from "@/lib/queue/queue";
import { getSession } from "@/lib/auth";
import { getRunState, runNeedsDrive } from "@/lib/arcs/queries";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, runId } = await params;
  try {
    const state = await getRunState(s.workspace.id, id, runId);
    if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Resume elapsed delays / orphaned runs. drive() is lock-guarded, so concurrent polls are safe.
    if (await runNeedsDrive(runId)) await enqueue("arc.drive", { runId }, { workspaceId: s.workspace.id, dedupeKey: `arc-nudge:${runId}` });
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api.arcRun]", e);
    return NextResponse.json({ error: "Run telemetry unavailable" }, { status: 500 });
  }
}
