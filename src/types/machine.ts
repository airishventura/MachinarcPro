export type MachineStatus = "draft" | "initializing" | "running" | "idle" | "paused" | "failed";
export type TaskStatus = "queued" | "initializing" | "running" | "waiting_approval" | "waiting_tool" | "completed" | "failed" | "cancelled" | "budget_exceeded" | "timeout";
export type RunStage = "queued" | "input" | "reason" | "execute" | "output" | "done";
export type LogLevel = string;

export type LogDTO = { id: string; level: string; message: string; createdAt: string; toolExecutionId?: string | null };
export type TaskResultDTO = { status: string; summary: string; content: string; structuredData: unknown | null; sources: { id: string; url: string; title: string }[] | null; artifacts: unknown[] | null; warnings: string[] | null; simulated?: boolean };
export type TaskDTO = { id: string; number: number; input: string; output: string | null; status: string; cost: number; tokens: number; durationMs: number; createdAt: string; startedAt: string | null; completedAt: string | null; result: TaskResultDTO | null; source: string };
export type ToolExecDTO = { id: string; toolId: string; status: string; summary: string; permission: string | null; permissionDecision: string | null; risk: string; input: unknown; output: unknown; outputPreview: string | null; error: string | null; simulated: boolean; startedAt: string | null; durationMs: number; createdAt: string };
export type ApprovalDTO = { id: string; toolId: string; permission: string; risk: string; title: string; destination: string | null; purpose: string; payloadSummary: string; status: string; decision: string | null; createdAt: string; persistable: boolean; kind: string };
export type RunDTO = { id: string; taskId: string; status: string; provider: string; model: string; turns: number; toolCalls: number; inputTokens: number; outputTokens: number; cost: number; aiCost: number; toolCost: number; childCost: number; pricingKnown: boolean; memoryCount: number; sourcesCount: number; depth: number; error: string | null; errorKind: string | null; cancelRequested: boolean; startedAt: string | null };

/** Payload of GET /api/machines/[id]/state — polled by the live console. */
export type MachineStateDTO = {
  machine: { status: string; currentTask: string | null; tasksCompleted: number; successRate: number; totalCost: number; totalRuntimeMs: number };
  task: TaskDTO | null; run: RunDTO | null; logs: LogDTO[]; tools: ToolExecDTO[]; approval: ApprovalDTO | null;
};
