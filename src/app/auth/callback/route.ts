import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { localChatgptRequestUrl, completeChatgptSignIn } from "@/lib/integrations/chatgpt-local";
import { db } from "@/db";
import { workspaceMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isDemoWorkspace } from "@/lib/integrations/service";

export async function GET(request: NextRequest) {
  let url: URL;
  try { url = localChatgptRequestUrl(request); } catch { return NextResponse.json({ error: "Local ChatGPT integration is disabled." }, { status: 403 }); }
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", url.origin));
  const jar = await cookies(), state = jar.get("marc_chatgpt_state")?.value;
  jar.set("marc_chatgpt_state", "", { path: "/auth/callback", maxAge: 0 });
  let status = "connected";
  try {
    const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, session.workspace.id));
    if (members.length !== 1 || members[0].userId !== session.user.id || members[0].role !== "owner" || await isDemoWorkspace(session.workspace.id)) throw new Error("Personal workspace required.");
    await completeChatgptSignIn(url, state, session.workspace.id, session.user.id);
  }
  catch { status = "failed"; }
  return NextResponse.redirect(new URL(`/app/settings/integrations?chatgpt=${status}`, url.origin));
}
