"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, machinePermissions, machines, users, workspaceMembers, workspaces } from "@/db/schema";
import { enqueue } from "@/lib/queue/queue";
import { provisionVisitorDemo } from "@/lib/seed/demo";
import { createSession, destroySession, hashPassword, requireSession, verifyPassword } from "@/lib/auth";
import { createMachine, initWorkspace, validateDraft, type MachineDraft } from "@/lib/machines/service";
import { MachineRuntime, RuntimeError } from "@/lib/runtime/machine-runtime";
import { LIMITS } from "@/lib/security/rate-limit";
import { sharedRateLimit } from "@/lib/security/shared-rate-limit";

function fail(where: string, e: unknown, fallback: string) {
  if (e instanceof RuntimeError) return { error: e.userMessage };
  console.error(`[action.${where}]`, e);
  return { error: fallback };
}

export type FormState = { error?: string } | undefined;

async function trustedClientAddress() {
  const h = await headers();
  // Only trust the address stamped by Vercel; other hosts share a conservative bucket.
  return process.env.VERCEL ? h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "unknown" : "unknown";
}

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");
  const name = String(fd.get("name") || "").trim() || email.split("@")[0];
  const wsName = String(fd.get("workspace") || "").trim() || `${name}'s Workspace`;
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password.length > 1024) return { error: "Password is too long." };
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (exists) return { error: "An operator with this email already exists." };
  try {
    const passwordHash = await hashPassword(password);
    const u = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email, name, passwordHash }).returning();
      const [ws] = await tx.insert(workspaces).values({ name: wsName }).returning();
      await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: "owner" });
      await initWorkspace(ws.id, name, tx);
      return user;
    });
    await createSession(u.id);
  } catch (e) {
    console.error("[action.register]", e);
    return { error: "We couldn't provision your workspace. Please try again." };
  }
  redirect("/onboarding");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");
  const ip = await trustedClientAddress();
  try {
    const ipAllowed = (await sharedRateLimit(`login:ip:${ip}`, LIMITS.loginPerIp)).ok;
    if (!ipAllowed || !(await sharedRateLimit(`login:account:${email}`, LIMITS.loginPerAccount)).ok) return { error: "Too many login attempts. Wait 15 minutes and try again." };
  } catch {
    return { error: "Login is temporarily unavailable. Please try again." };
  }
  if (email.length > 254 || password.length > 1024) return { error: "Invalid credentials." };
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u?.passwordHash || !await verifyPassword(password, u.passwordHash)) return { error: "Invalid credentials." };
  await createSession(u.id);
  redirect(u.onboarded ? "/app" : "/onboarding");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function finishOnboarding() {
  const s = await requireSession();
  await db.update(users).set({ onboarded: true }).where(eq(users.id, s.user.id));
}

export async function deployMachineAction(d: MachineDraft): Promise<{ id: string } | { error: string }> {
  const s = await requireSession();
  const invalid = d.modelProvider === "chatgpt" ? null : validateDraft(d); // createMachine validates the local account catalog server-side.
  if (invalid) return { error: invalid };
  try {
    const m = await createMachine(s.workspace.id, d);
    const rt = await MachineRuntime.load(m.id, s.workspace.id);
    await enqueue("machine.deploy", { machineId: rt.machine.id, workspaceId: rt.machine.workspaceId }, { workspaceId: rt.machine.workspaceId, dedupeKey: `deploy:${rt.machine.id}` });
    revalidatePath("/app/machines");
    return { id: m.id };
  } catch (e) {
    if (String((e as { code?: string })?.code) === "23505") return { error: "Machine ID collision — regenerate the ID and retry." };
    return fail("deploy", e, "Machine creation failed. Your configuration was not saved — please retry.");
  }
}

export async function retryDeployAction(machineId: string) {
  const s = await requireSession();
  try {
    await db.update(machines).set({ status: "initializing" }).where(and(eq(machines.id, machineId), eq(machines.workspaceId, s.workspace.id)));
    const rt = await MachineRuntime.load(machineId, s.workspace.id);
    await enqueue("machine.deploy", { machineId: rt.machine.id, workspaceId: rt.machine.workspaceId }, { workspaceId: rt.machine.workspaceId, dedupeKey: `deploy:${rt.machine.id}` });
    return { ok: true };
  } catch (e) { return fail("retryDeploy", e, "Could not restart initialization."); }
}

export async function runTaskAction(machineId: string, input: string): Promise<{ taskId: string } | { error: string }> {
  const s = await requireSession();
  const text = input.trim();
  if (text.length < 3) return { error: "Describe the task (at least 3 characters)." };
  if (text.length > 4000) return { error: "Task is too long (4000 characters max)." };
  try {
    const rt = await MachineRuntime.load(machineId, s.workspace.id);
    const { task, run } = await rt.createRun(text);
    await enqueue("machine.execute", { runId: run.id }, { workspaceId: s.workspace.id, dedupeKey: `machine:${run.id}` });
    void task;
    return { taskId: task.id };
  } catch (e) { return fail("runTask", e, "Task could not be queued. Please retry."); }
}

export async function setMachineStatus(machineId: string, status: "paused" | "idle") {
  const s = await requireSession();
  try {
    const rt = await MachineRuntime.load(machineId, s.workspace.id);
    if (status === "paused" && rt.machine.status === "initializing") return { error: "Wait for initialization to finish." };
    if (status === "idle" && rt.machine.status !== "paused" && rt.machine.status !== "failed") return { ok: true };
    await db.update(machines).set({ status, updatedAt: new Date() }).where(eq(machines.id, machineId));
    await rt.writeLog(status === "paused" ? "WARNING" : "SYSTEM", status === "paused" ? "Machine paused by operator" : "Machine resumed by operator");
    await rt.activity("machines", `${rt.machine.name} ${status === "paused" ? "paused by operator" : "resumed"}.`, status === "paused" ? "warning" : "info");
    revalidatePath(`/app/machines/${machineId}`);
    return { ok: true };
  } catch (e) { return fail("status", e, "Status change failed."); }
}

export async function updateMachineAction(machineId: string, f: { name: string; description: string; objective: string; successCriteria: string; systemPrompt: string; dailyBudget: number; monthlyBudget: number }) {
  const s = await requireSession();
  if (f.name.trim().length < 2) return { error: "Name must be at least 2 characters." };
  if (f.objective.trim().length < 10) return { error: "Objective must be at least 10 characters." };
  if (!(f.dailyBudget >= 0) || f.monthlyBudget < f.dailyBudget) return { error: "Monthly budget must be at least the daily budget." };
  try {
    await db.update(machines).set({ name: f.name.trim().toUpperCase(), description: f.description.trim(), objective: f.objective.trim(), successCriteria: f.successCriteria.trim(), systemPrompt: f.systemPrompt.trim(), dailyBudget: f.dailyBudget, monthlyBudget: f.monthlyBudget, updatedAt: new Date() })
      .where(and(eq(machines.id, machineId), eq(machines.workspaceId, s.workspace.id)));
    const rt = await MachineRuntime.load(machineId, s.workspace.id);
    await rt.writeLog("SYSTEM", "Configuration updated by operator");
    revalidatePath(`/app/machines/${machineId}`);
    return { ok: true };
  } catch (e) { return fail("update", e, "Configuration could not be saved."); }
}

export async function deleteMachine(machineId: string) {
  const s = await requireSession();
  await db.delete(machines).where(and(eq(machines.id, machineId), eq(machines.workspaceId, s.workspace.id)));
  redirect("/app/machines");
}


export async function hireAction(fromMachineId: string, code: string, purpose: string) {
  const s = await requireSession();
  try {
    const rt = await MachineRuntime.load(fromMachineId, s.workspace.id);
    const r = await rt.requestMachine(code, purpose || "Network task");
    revalidatePath("/app/economy");
    return r;
  } catch (e) {
    console.error("[action.hire]", e);
    return { status: "error" as const, error: "Hire failed." };
  }
}


/** One-click access to a private visitor demo using the canonical demo dataset. */
export async function enterDemoAction() {
  const ip = await trustedClientAddress();
  let allowed = false;
  try { allowed = (await sharedRateLimit(`demo:ip:${ip}`, LIMITS.demoPerIp)).ok; }
  catch { redirect("/login?demo=failed"); }
  if (!allowed) redirect("/login?demo=limited");
  let uid: string;
  try { uid = await provisionVisitorDemo(); }
  catch (e) { console.error("[action.demo]", e); redirect("/login?demo=failed"); }
  await createSession(uid);
  redirect("/app");
}
