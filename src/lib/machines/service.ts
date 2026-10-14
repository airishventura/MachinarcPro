import "server-only";
import { db } from "@/db";
import { activities, machinePermissions, machines, machineTools } from "@/db/schema";
import { PERMISSIONS, TOOL_CATALOG } from "@/config/tools";
import { draftDefaults, validateDraft, type MachineDraft } from "@/lib/machines/drafts";
import { MODELS } from "@/config/models";
import { chatgptLocalStatus } from "@/lib/integrations/chatgpt-local";

export { validateDraft, draftDefaults };
export type { MachineDraft };

const cleanDomains = (d?: string[]) => (d ?? []).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)).slice(0, 20);

/** Persists a Machine (INITIALIZING) with tools + explicit permissions. Server is the source of truth for every field. */
export async function createMachine(workspaceId: string, input: Partial<MachineDraft>, status: "initializing" | "idle" = "initializing") {
  const d = draftDefaults(input);
  const local = d.modelProvider === "chatgpt" ? await chatgptLocalStatus(workspaceId) : null;
  const invalid = validateDraft(d, [...MODELS, ...(local?.models ?? [])]);
  if (invalid) throw new Error(invalid);
  const [m] = await db.insert(machines).values({
    workspaceId, name: d.name.trim().toUpperCase(), machineCode: d.machineCode, machineType: d.machineType, description: d.description.trim(),
    objective: d.objective.trim(), successCriteria: d.successCriteria.trim(), modelProvider: d.modelProvider, modelName: d.modelName,
    systemPrompt: d.systemPrompt.trim().slice(0, 8000), reasoning: d.reasoning, outputMode: d.outputMode,
    outputSchema: d.outputMode === "structured" ? d.outputSchema : null, maxRuntimeSec: d.maxRuntimeSec, maxToolCalls: d.maxToolCalls, maxTurns: d.maxTurns,
    memoryMode: d.memoryMode, dailyBudget: d.dailyBudget, monthlyBudget: d.monthlyBudget, maxTaskCost: d.maxTaskCost, status,
  }).returning();
  const known = new Set(TOOL_CATALOG.filter((t) => t.status !== "sandbox_required").map((t) => t.id));
  const tools = d.tools.filter((t) => t.enabled && (known.has(t.id) || /^api__[a-z0-9_]{1,24}$/.test(t.id)));
  if (tools.length) await db.insert(machineTools).values(tools.map((t) => ({ machineId: m.id, tool: t.id, enabled: true, permission: TOOL_CATALOG.find((c) => c.id === t.id)?.level ?? "WRITE", config: t.config?.allowedDomains ? { allowedDomains: cleanDomains(t.config.allowedDomains) } : {} })));
  await db.insert(machinePermissions).values(PERMISSIONS.map((p) => ({ machineId: m.id, permission: p.key, mode: d.permissions[p.key] })));
  return m;
}

export async function initWorkspace(workspaceId: string, operator: string, writer: Pick<typeof db, "insert"> = db) {
  await writer.insert(activities).values({ workspaceId, category: "system", actor: "SYSTEM", message: `Workspace provisioned for ${operator}. 500 Credits allocated.`, severity: "info" });
}
export { cleanDomains };
