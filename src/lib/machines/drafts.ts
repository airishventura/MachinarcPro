// Client-safe Machine draft model + defaults + validation (shared by builder UI and server).
import { DEFAULT_PERMISSIONS, PERMISSIONS, TOOL_CATALOG, type OutputField, type PermissionKey, type PermissionMode } from "@/config/tools";
import { MODELS } from "@/config/models";

export type MachineDraft = {
  name: string; machineType: string; description: string; machineCode: string;
  objective: string; successCriteria: string;
  modelProvider: string; modelName: string; systemPrompt: string; reasoning: "low" | "medium" | "high";
  outputMode: "text" | "structured"; outputSchema: { name: string; list: boolean; fields: OutputField[] } | null;
  maxRuntimeSec: number; maxToolCalls: number; maxTurns: number;
  tools: { id: string; enabled: boolean; config?: { allowedDomains?: string[] } }[];
  memoryMode: "none" | "session" | "persistent" | "structured";
  dailyBudget: number; monthlyBudget: number; maxTaskCost: number;
  permissions: Record<PermissionKey, PermissionMode>;
};

export const BUILDER_TYPES = ["research", "monitoring", "analysis", "coding", "operations", "custom"] as const;

export function draftDefaults(p: Partial<MachineDraft> = {}): MachineDraft {
  return {
    name: "", machineType: "research", description: "", machineCode: "MARC-SCT-0000", objective: "", successCriteria: "",
    modelProvider: "mock", modelName: "mock-runtime", systemPrompt: "", reasoning: "medium",
    outputMode: "text", outputSchema: null, maxRuntimeSec: 180, maxToolCalls: 12, maxTurns: 8,
    tools: TOOL_CATALOG.filter((t) => t.status !== "sandbox_required").map((t) => ({ id: t.id, enabled: !!t.defaultOn })),
    memoryMode: "session", dailyBudget: 5, monthlyBudget: 50, maxTaskCost: 1,
    permissions: { ...DEFAULT_PERMISSIONS }, ...p,
  };
}

export function validateDraft(d: MachineDraft): string | null {
  if (!d.name?.trim() || d.name.trim().length < 2) return "Machine name must be at least 2 characters.";
  if (d.name.length > 40) return "Machine name must be 40 characters or fewer.";
  if (!(BUILDER_TYPES as readonly string[]).includes(d.machineType)) return "Select a Machine type.";
  if (!d.objective?.trim() || d.objective.trim().length < 10) return "Objective must be at least 10 characters.";
  if (!MODELS.some((m) => m.provider === d.modelProvider && m.id === d.modelName && m.enabled)) return "Select a model from the registry.";
  if (!/^MARC-[A-Z]{3}-\d{4}$/.test(d.machineCode)) return "Invalid Machine ID.";
  if (!(d.dailyBudget >= 0) || !(d.monthlyBudget >= d.dailyBudget)) return "Monthly budget must be at least the daily budget.";
  if (!(d.maxTaskCost > 0) || d.maxTaskCost > d.dailyBudget && d.dailyBudget > 0) return "Max task cost must be greater than 0 and not exceed the daily budget.";
  if (d.maxRuntimeSec < 10 || d.maxRuntimeSec > 900) return "Max runtime must be between 10 and 900 seconds.";
  if (d.maxToolCalls < 0 || d.maxToolCalls > 50) return "Max tool calls must be between 0 and 50.";
  if (d.maxTurns < 1 || d.maxTurns > 30) return "Max AI turns must be between 1 and 30.";
  if (d.outputMode === "structured") {
    const f = d.outputSchema?.fields ?? [];
    if (!f.length) return "Structured output needs at least one field.";
    if (f.some((x) => !/^[a-z][a-z0-9_]{0,39}$/.test(x.key))) return "Field keys must be lowercase snake_case.";
    if (new Set(f.map((x) => x.key)).size !== f.length) return "Field keys must be unique.";
  }
  for (const p of PERMISSIONS) if (!["DENY", "ASK", "ALLOW"].includes(d.permissions[p.key])) return `Invalid mode for ${p.label}.`;
  return null;
}
