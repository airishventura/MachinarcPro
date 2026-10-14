import { getSession } from "@/lib/auth";
import { enqueueMachineRun } from "@/lib/machines/run-service";
import { RuntimeError } from "@/lib/runtime/machine-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Next may normalize request.url to its listening hostname; the browser sends the real Host.
  const origin = request.headers.get("origin");
  try {
    const source = new URL(origin ?? "");
    if (source.origin !== origin || source.host !== request.headers.get("host")?.toLowerCase()) throw new Error();
  } catch { return Response.json({ error: "Forbidden" }, { status: 403 }); }
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Invalid input" }, { status: 400 });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 20_000) {
          await reader.cancel();
          return Response.json({ error: "Payload too large" }, { status: 413 });
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const { id } = await params;
    if (typeof body?.input !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid input" }, { status: 400 });
    const { run } = await enqueueMachineRun(id, session.workspace.id, body.input);
    return Response.json({ runId: run.id, status: "queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof RuntimeError) return Response.json({ error: error.userMessage }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON" }, { status: 400 });
    return Response.json({ error: "Task could not be queued" }, { status: 503 });
  }
}
