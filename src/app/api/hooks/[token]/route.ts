import { handleInboundWebhook } from "@/lib/automation/inbound-webhook";

export const dynamic = "force-dynamic";

/** Public inbound webhook. Authenticated by an unguessable token; never executes synchronously. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleInboundWebhook(req, token);
}
export function GET() { return Response.json({ error: "use POST" }, { status: 405, headers: { Allow: "POST" } }); }
