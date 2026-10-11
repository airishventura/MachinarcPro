import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMachineState } from "@/lib/machines/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const taskId = new URL(req.url).searchParams.get("task");
  try {
    const state = await getMachineState(id, s.workspace.id, taskId);
    if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api.state]", e);
    return NextResponse.json({ error: "Telemetry unavailable" }, { status: 500 });
  }
}
