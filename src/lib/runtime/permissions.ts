import { PERMISSIONS, type PermissionKey, type PermissionMode } from "@/config/tools";
import type { Tool } from "@/lib/tools/types";

export type Decision = { decision: "ALLOW" | "DENY" | "ASK"; permission: PermissionKey | null; reason: string; risk: "low" | "medium" | "high" };

/** Permissions eligible for "ALWAYS ALLOW" from an approval card. Others require editing Machine settings. */
export const PERSISTABLE: PermissionKey[] = ["network_read", "memory_write", "machine_call"];

/**
 * Trusted permission evaluation. Order: tool availability → explicit always-ask → workspace policy →
 * Machine policy → per-run approvals → escalation rules. The model never participates in this decision.
 */
export function evaluatePermission(p: {
  tool: Tool; args: Record<string, unknown>; config: Record<string, unknown>;
  machinePerms: Partial<Record<string, string>>; workspaceDeny: string[]; approvedForRun: string[];
}): Decision {
  const { tool, args } = p;
  const risk = tool.risk(args);
  const permission = tool.permission(args, { config: p.config });
  const runKey = `${tool.id}:${permission ?? "none"}`;
  if (tool.status === "sandbox_required") return { decision: "DENY", permission, reason: "SANDBOX REQUIRED — no isolated execution environment is configured.", risk };
  if (tool.alwaysAsk) return p.approvedForRun.includes(runKey) ? { decision: "ALLOW", permission, reason: "Approved for this run.", risk } : { decision: "ASK", permission, reason: "This tool always requires operator confirmation.", risk };
  if (!permission) return { decision: "ALLOW", permission, reason: "No permission required.", risk };
  if (p.workspaceDeny.includes(permission)) return { decision: "DENY", permission, reason: `Workspace policy denies ${label(permission)}.`, risk };
  const mode = (p.machinePerms[permission] ?? "DENY") as PermissionMode;
  if (mode === "DENY") return { decision: "DENY", permission, reason: `${label(permission)} is DENY for this Machine.`, risk };
  if (p.approvedForRun.includes(runKey)) return { decision: "ALLOW", permission, reason: "Approved by operator for this run.", risk };
  if (mode === "ASK") return { decision: "ASK", permission, reason: `${label(permission)} requires operator approval.`, risk };
  if (tool.requiresApproval?.(args, p.config)) return { decision: "ASK", permission, reason: "No domain allow-list configured — external writes require approval.", risk };
  return { decision: "ALLOW", permission, reason: `${label(permission)} is ALLOW for this Machine.`, risk };
}

export const label = (k: string) => PERMISSIONS.find((x) => x.key === k)?.label ?? k;
