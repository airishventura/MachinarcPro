import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, workspaceMembers, workspaces } from "@/db/schema";
import { visitorDemoExpiresAt } from "@/lib/seed/demo-retention";

const COOKIE = "marc_session";
export { hashPassword, verifyPassword } from "@/lib/security/password";

export async function createSession(userId: string) {
  const sid = randomBytes(32).toString("hex");
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found.");
  const expiresAt = visitorDemoExpiresAt(user) ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  if (expiresAt <= new Date()) throw new Error("Visitor demo has expired. Enter a new demo.");
  await db.insert(sessions).values({ id: sid, userId, expiresAt });
  (await cookies()).set(COOKIE, sid, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: expiresAt, path: "/" });
}

export async function destroySession() {
  const c = await cookies();
  const sid = c.get(COOKIE)?.value;
  if (sid) await db.delete(sessions).where(eq(sessions.id, sid));
  c.delete(COOKIE);
}

export async function getSession() {
  const sid = (await cookies()).get(COOKIE)?.value;
  if (!sid) return null;
  const rows = await db
    .select({ user: users, ws: workspaces, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(sessions.id, sid))
    .limit(1);
  const r = rows[0];
  if (!r || r.expiresAt < new Date()) return null;
  const visitorExpiresAt = visitorDemoExpiresAt(r.user);
  if (visitorExpiresAt && visitorExpiresAt <= new Date()) return null;
  // Retire sessions issued by the old public, shared demo identity.
  if (r.user.email === "demo@machinarcpro.com") return null;
  return { user: r.user, workspace: r.ws };
}

export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
