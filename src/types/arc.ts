import type { Graph } from "@/lib/arcs/graph";

export type ArcDisplayStatus = "running" | "waiting" | "idle" | "draft" | "failed" | "paused" | "disabled";

export type ArcCardDTO = {
  id: string; name: string; arcCode: string; description: string; status: ArcDisplayStatus; nodesCount: number;
  chain: string[]; machinesCount: number; runsCompleted: number; successRate: number; lastRunAt: string | null; activity: string | null;
};

export type RunNodeDTO = {
  key: string; type: string; label: string; status: string; branch: string | null; input: string | null; output: string | null; error: string | null;
  startedAt: string | null; completedAt: string | null; durationMs: number; cost: number; attempts: number; attemptLog: { attempt: number; status: string; taskId?: string; cost: number; error?: string }[];
  machineId: string | null; machineTaskId: string | null; resumeAt: string | null; detail: string | null;
};

export type ArcRunStateDTO = {
  run: { id: string; code: string; arcId: string; status: string; isTest: boolean; input: string; finalOutput: string | null; startedAt: string | null; completedAt: string | null; durationMs: number; estimatedCost: number; cost: number; errorMessage: string | null; failedNodeKey: string | null; createdAt: string };
  nodes: RunNodeDTO[];
  events: { id: string; nodeKey: string | null; type: string; message: string; createdAt: string }[];
  approvals: { id: string; nodeKey: string; kind: string; title: string; reason: string; data: string; status: string }[];
  graph: Graph;
};

export type ArcRunRowDTO = { id: string; code: string; arcId: string; arcName: string; status: string; isTest: boolean; machines: number; durationMs: number; cost: number; createdAt: string; input: string };
