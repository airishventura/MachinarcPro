import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, eventTriggers, machines, schedules, users, workspaceMembers, workspaces } from "@/db/schema";
import { hashPassword } from "@/lib/security/password";
import { STARTERS, machineCode } from "@/lib/domain";
import { createMachine, draftDefaults, initWorkspace } from "@/lib/machines/service";
import { instantiateTemplate, seedDemoRuns } from "@/lib/arcs/service";
import { computeNextRun } from "@/lib/automation/triggers";

export const DEMO_EMAIL = "demo@machinarcpro.com";

/**
 * The single source of demo data. Used by "Enter Demo" and `scripts/seed-demo.ts`.
 * Provisions: operator + workspace, Research Scout + Sentinel Machines, the EMERGING TECH
 * INTELLIGENCE Arc with realistic history, a continuous schedule, and an event trigger.
 */
export async function provisionDemo(): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (existing) return existing.id;
  const [u] = await db.insert(users).values({ email: DEMO_EMAIL, name: "Demo Operator", passwordHash: await hashPassword(randomUUID()), onboarded: true }).onConflictDoNothing().returning();
  if (!u) return (await db.select().from(users).where(eq(users.email, DEMO_EMAIL)))[0].id; // concurrent provisioning
  const [ws] = await db.insert(workspaces).values({ name: "MachinArc Demo", policy: { demo: true } }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role: "owner" });
  await seedWorkspaceDemo(ws.id);
  return u.id;
}

/** Public demo access always creates an isolated, credential-free visitor workspace. */
export async function provisionVisitorDemo(): Promise<string> {
  const { user, workspace } = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email: `demo-${randomUUID()}@machinarc.invalid`, name: "Demo Operator", onboarded: true }).returning();
    const [workspace] = await tx.insert(workspaces).values({ name: "MachinArc Demo", policy: { demo: true } }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "owner" });
    return { user, workspace };
  });
  try {
    await seedWorkspaceDemo(workspace.id, { scheduleEnabled: false });
    return user.id;
  } catch (error) {
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
    await db.delete(users).where(eq(users.id, user.id));
    throw error;
  }
}

export async function seedWorkspaceDemo(workspaceId: string, options: { scheduleEnabled?: boolean } = {}) {
  await initWorkspace(workspaceId, "Demo Operator");
  const made: Record<string, string> = {};
  for (const s of [STARTERS.research_scout, STARTERS.monitor]) {
    const m = await createMachine(workspaceId, {
      name: s.name, machineType: s.type, description: s.description, machineCode: machineCode(s.type), objective: s.objective, successCriteria: s.successCriteria, systemPrompt: s.systemPrompt,
      tools: draftDefaults().tools.map((t) => ({ ...t, enabled: (s.tools ?? []).includes(t.id) })), memoryMode: s.memoryMode ?? "session",
    }, "idle");
    made[s.name] = m.id;
    await db.insert(activities).values({ workspaceId, machineId: m.id, category: "machines", actor: m.name, message: `${m.name} deployed successfully.`, severity: "success" });
  }
  const arc = await instantiateTemplate(workspaceId, "emerging-tech", { status: "deployed" });
  await seedDemoRuns(arc.id, workspaceId);
  const scout = made[STARTERS.research_scout.name];
  // Continuous operation: hourly autonomous scan (Mock Runtime — no external cost).
  await db.insert(schedules).values({ workspaceId, name: "Hourly signal scan", targetType: "machine", targetId: scout, kind: "interval", intervalSec: 3600, input: "Scan for new AI infrastructure launches in the last hour", enabled: options.scheduleEnabled ?? true, nextRunAt: computeNextRun({ kind: "interval", intervalSec: 3600, cron: null }) });
  // Event: when the Scout completes, brief via the Arc.
  await db.insert(eventTriggers).values({ workspaceId, name: "Scout → Intelligence Arc", sourceType: "machine", sourceId: scout, onStatus: "completed", targetType: "arc", targetId: arc.id, inputTemplate: "Brief the operator on these findings:\n{{output}}", enabled: false });
  const [m] = await db.select({ id: machines.id }).from(machines).where(eq(machines.id, scout));
  return { scoutId: m.id, arcId: arc.id };
}
