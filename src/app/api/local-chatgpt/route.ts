import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { workspaceMembers } from "@/db/schema";
import { isDemoWorkspace } from "@/lib/integrations/service";
import { localChatgptRequestUrl, beginChatgptSignIn, disconnectChatgpt } from "@/lib/integrations/chatgpt-local";

export async function POST(request: NextRequest) {
  let url: URL;
  try { url = localChatgptRequestUrl(request); } catch { return NextResponse.json({ error: "Local ChatGPT integration is disabled or this is not a loopback origin." }, { status: 403 }); }
  if (request.headers.get("origin") !== url.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const members = await db.select({ role: workspaceMembers.role, userId: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, session.workspace.id));
  if (members.length !== 1 || members[0].role !== "owner" || members[0].userId !== session.user.id || await isDemoWorkspace(session.workspace.id)) return NextResponse.json({ error: "Use an owner account in a personal local workspace with one member." }, { status: 403 });
  const data = await request.formData();
  try {
    if (data.get("action") === "disconnect") {
      const revoked = await disconnectChatgpt(session.workspace.id);
      (await cookies()).set("marc_chatgpt_state", "", { path: "/auth/callback", maxAge: 0 });
      return NextResponse.redirect(new URL(`/app/settings/integrations?chatgpt=${revoked ? "disconnected" : "revocation_unconfirmed"}`, url.origin), 303);
    }
    const selected = data.get("account");
    const attempt = await beginChatgptSignIn(session.workspace.id, session.user.id, url.origin, data.get("action") === "different", typeof selected === "string" && selected ? selected : undefined);
    (await cookies()).set("marc_chatgpt_state", attempt.state, { httpOnly: true, sameSite: "lax", secure: false, path: "/auth/callback", maxAge: 600 });
    return NextResponse.redirect(attempt.url, 303);
  } catch { return NextResponse.redirect(new URL("/app/settings/integrations?chatgpt=failed", url.origin), 303); }
}
