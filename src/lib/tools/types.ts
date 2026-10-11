import type { JSONSchema } from "@/lib/tools/schema";
import type { PermissionKey, ToolCategory } from "@/config/tools";

export type ToolErrorKind = "invalid_input" | "timeout" | "network" | "http_error" | "rate_limited" | "permission_denied" | "blocked" | "too_large" | "unavailable" | "malformed_output" | "sandbox_required" | "not_found";
export type ToolResult = {
  ok: boolean; data?: unknown; preview: string; sources?: { url: string; title: string; meta?: Record<string, unknown> }[];
  error?: { kind: ToolErrorKind; message: string }; cost?: number; simulated?: boolean;
};

export type ToolContext = {
  workspaceId: string; machineId: string; machineName: string; runId: string; taskId: string; depth: number;
  simulated: boolean; signal: AbortSignal; config: Record<string, unknown>; secrets: string[];
  llmStructured: (text: string, schema: JSONSchema, instruction: string) => Promise<{ data: unknown; repaired: boolean }>;
  writeMemory: (m: { content: string; importance: number; kind: string }) => Promise<{ id: string }>;
  callMachine: (target: string, task: string, context?: string) => Promise<ToolResult>;
};

export interface Tool {
  id: string; name: string; description: string; category: ToolCategory; inputSchema: JSONSchema;
  /** Permission required for these arguments (may depend on method etc.). */
  permission(args: Record<string, unknown>, ctx?: { config: Record<string, unknown> }): PermissionKey | null;
  risk(args: Record<string, unknown>): "low" | "medium" | "high";
  /** Human-readable one-liner for telemetry, e.g. "GET api.example.com". */
  summarize(args: Record<string, unknown>): string;
  destination?(args: Record<string, unknown>): string | null;
  alwaysAsk?: boolean;
  /** Escalate ALLOW → ASK when the call is risky under current config (e.g. POST without allow-list). */
  requiresApproval?(args: Record<string, unknown>, config: Record<string, unknown>): boolean;
  validateInput?(args: Record<string, unknown>): string[];
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  simulate?(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  status?: "available" | "sandbox_required";
}
