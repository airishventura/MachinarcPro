import { pgTable, pgEnum, text, integer, real, timestamp, jsonb, boolean, uuid, primaryKey, index, uniqueIndex, check, serial } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at").defaultNow().notNull();

export const machineStatus = pgEnum("machine_status", ["draft", "initializing", "running", "idle", "paused", "failed"]);
export const taskStatus = pgEnum("task_status", ["queued", "initializing", "running", "waiting_approval", "waiting_tool", "completed", "failed", "cancelled", "budget_exceeded", "timeout"]);
export const memberRole = pgEnum("member_role", ["owner", "operator", "viewer"]);

/** Operator profile. Maps 1:1 to an auth identity (Supabase auth.users compatible). */
export const users = pgTable("profiles", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  googleId: text("google_id"),
  onboarded: boolean("onboarded").default(false).notNull(),
  createdAt: created(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").default("PRO").notNull(),
  credits: real("credits").default(500).notNull(),
  policy: jsonb("policy").$type<{ denyPermissions?: string[]; maxConcurrentRuns?: number; demo?: boolean }>().default({}).notNull(),
  createdAt: created(),
});

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRole("role").default("operator").notNull(),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("members_user_idx").on(t.userId)]);

export const machines = pgTable("machines", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  machineCode: text("machine_code").notNull().unique(),
  description: text("description").default("").notNull(),
  objective: text("objective").default("").notNull(),
  successCriteria: text("success_criteria").default("").notNull(),
  status: machineStatus("status").default("draft").notNull(),
  machineType: text("machine_type").default("research").notNull(),
  modelProvider: text("model_provider").default("mock").notNull(),
  modelName: text("model_name").default("mock-runtime").notNull(),
  systemPrompt: text("system_prompt").default("").notNull(),
  temperature: real("temperature").default(0.4).notNull(),
  reasoning: text("reasoning").default("medium").notNull(),
  contextLimit: integer("context_limit").default(32000).notNull(),
  memoryMode: text("memory_mode").default("session").notNull(),
  outputMode: text("output_mode").default("text").notNull(),
  outputSchema: jsonb("output_schema").$type<{ name: string; fields: { key: string; type: string; description?: string; required?: boolean }[]; list?: boolean } | null>(),
  maxTurns: integer("max_turns").default(8).notNull(),
  maxToolCalls: integer("max_tool_calls").default(12).notNull(),
  maxRuntimeSec: integer("max_runtime_sec").default(180).notNull(),
  memoryConfig: jsonb("memory_config").$type<{ retentionDays: number; sizeMb: number; scope: string }>(),
  triggers: jsonb("triggers").$type<{ type: string; value: string }[]>().default([]).notNull(),
  dailyBudget: real("daily_budget").default(10).notNull(),
  monthlyBudget: real("monthly_budget").default(150).notNull(),
  maxTaskCost: real("max_task_cost").default(1).notNull(),
  approvalAbove: real("approval_above").default(5).notNull(),
  allowM2M: boolean("allow_m2m").default(false).notNull(),
  currentTask: text("current_task"),
  reputationScore: real("reputation_score").default(80).notNull(),
  successRate: real("success_rate").default(0).notNull(),
  tasksCompleted: integer("tasks_completed").default(0).notNull(),
  successfulTasks: integer("successful_tasks").default(0).notNull(),
  tasksFailed: integer("tasks_failed").default(0).notNull(),
  totalRuntimeMs: integer("total_runtime_ms").default(0).notNull(),
  totalCost: real("total_cost").default(0).notNull(),
  totalRevenue: real("total_revenue").default(0).notNull(),
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  createdAt: created(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("machines_ws_idx").on(t.workspaceId),
  index("machines_ws_status_idx").on(t.workspaceId, t.status),
  check("machines_budget_chk", sql`${t.dailyBudget} >= 0 AND ${t.monthlyBudget} >= ${t.dailyBudget}`),
]);

export const machineTools = pgTable("machine_tools", {
  id: id(),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  permission: text("permission").default("READ").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
}, (t) => [index("tools_machine_idx").on(t.machineId)]);

export const machinePermissions = pgTable("machine_permissions", {
  id: id(),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
  mode: text("mode").default("ASK").notNull(),
}, (t) => [index("perms_machine_idx").on(t.machineId)]);

export const machineMemories = pgTable("machine_memories", {
  id: id(),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").default("fact").notNull(),
  content: text("content").notNull(),
  summary: text("summary").default("").notNull(),
  importance: integer("importance").default(3).notNull(),
  source: text("source").default("operator").notNull(),
  sourceRunId: uuid("source_run_id"),
  pinned: boolean("pinned").default(false).notNull(),
  usedCount: integer("used_count").default(0).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  lastAccessedAt: timestamp("last_accessed_at"),
  createdAt: created(),
}, (t) => [index("memories_machine_idx").on(t.machineId, t.createdAt), check("memories_importance_chk", sql`${t.importance} between 1 and 5`)]);

export const machineTasks = pgTable("machine_tasks", {
  id: id(),
  number: integer("number").notNull(),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  input: text("input").notNull(),
  output: text("output"),
  result: jsonb("result").$type<TaskResult>(),
  parentTaskId: uuid("parent_task_id"),
  triggerDepth: integer("trigger_depth").default(0).notNull(),
  status: taskStatus("status").default("queued").notNull(),
  cost: real("cost").default(0).notNull(),
  tokens: integer("tokens").default(0).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  source: text("source").default("operator").notNull(),
  createdAt: created(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (t) => [index("tasks_machine_idx").on(t.machineId, t.createdAt), index("tasks_ws_idx").on(t.workspaceId, t.createdAt)]);

export const machineRuns = pgTable("machine_runs", {
  id: id(),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => machineTasks.id, { onDelete: "cascade" }),
  status: taskStatus("status").default("queued").notNull(),
  provider: text("provider").default("mock").notNull(),
  model: text("model").default("mock-runtime").notNull(),
  tokens: integer("tokens").default(0).notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  cachedTokens: integer("cached_tokens").default(0).notNull(),
  turns: integer("turns").default(0).notNull(),
  toolCalls: integer("tool_calls").default(0).notNull(),
  aiCost: real("ai_cost").default(0).notNull(),
  toolCost: real("tool_cost").default(0).notNull(),
  childCost: real("child_cost").default(0).notNull(),
  cost: real("cost").default(0).notNull(),
  pricingKnown: boolean("pricing_known").default(true).notNull(),
  depth: integer("depth").default(0).notNull(),
  parentRunId: uuid("parent_run_id"),
  messages: jsonb("messages").$type<unknown[]>().default([]).notNull(),
  pendingToolCall: jsonb("pending_tool_call").$type<{ id: string; name: string; args: Record<string, unknown> } | null>(),
  approvedTools: jsonb("approved_tools").$type<string[]>().default([]).notNull(),
  memoryIds: jsonb("memory_ids").$type<string[]>().default([]).notNull(),
  cancelRequested: boolean("cancel_requested").default(false).notNull(),
  lockUntil: timestamp("lock_until"),
  error: text("error"),
  errorKind: text("error_kind"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: created(),
}, (t) => [index("runs_task_idx").on(t.taskId), index("runs_machine_idx").on(t.machineId)]);

export type TaskResult = {
  status: string; summary: string; content: string; structuredData: unknown | null;
  sources: { id: string; url: string; title: string }[] | null; artifacts: unknown[] | null; warnings: string[] | null; simulated?: boolean;
};

export const toolExecutions = pgTable("tool_executions", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  machineRunId: uuid("machine_run_id").notNull().references(() => machineRuns.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  toolId: text("tool_id").notNull(),
  status: text("status").default("requested").notNull(),
  permission: text("permission"),
  permissionDecision: text("permission_decision"),
  risk: text("risk").default("low").notNull(),
  summary: text("summary").default("").notNull(),
  inputPayload: jsonb("input_payload").$type<Record<string, unknown>>(),
  outputPayload: jsonb("output_payload").$type<Record<string, unknown>>(),
  outputPreview: text("output_preview"),
  error: text("error"),
  simulated: boolean("simulated").default(false).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms").default(0).notNull(),
  estimatedCost: real("estimated_cost").default(0).notNull(),
  createdAt: created(),
}, (t) => [index("toolexec_run_idx").on(t.machineRunId, t.createdAt), uniqueIndex("toolexec_call_uq").on(t.machineRunId, t.toolCallId)]);

export const runSources = pgTable("run_sources", {
  id: id(),
  machineRunId: uuid("machine_run_id").notNull().references(() => machineRuns.id, { onDelete: "cascade" }),
  ref: text("ref").notNull(),
  url: text("url").notNull(),
  title: text("title").default("").notNull(),
  toolExecutionId: uuid("tool_execution_id").references(() => toolExecutions.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  accessedAt: created(),
}, (t) => [uniqueIndex("run_sources_uq").on(t.machineRunId, t.url)]);

export const runUsage = pgTable("run_usage", {
  id: id(),
  machineRunId: uuid("machine_run_id").notNull().references(() => machineRuns.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  cachedTokens: integer("cached_tokens").default(0).notNull(),
  cost: real("cost"),
  latencyMs: integer("latency_ms").default(0).notNull(),
  finishReason: text("finish_reason"),
  createdAt: created(),
}, (t) => [index("run_usage_run_idx").on(t.machineRunId)]);

export const machineCallRelationships = pgTable("machine_call_relationships", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  parentRunId: uuid("parent_run_id").notNull().references(() => machineRuns.id, { onDelete: "cascade" }),
  childRunId: uuid("child_run_id").references(() => machineRuns.id, { onDelete: "set null" }),
  parentMachineId: uuid("parent_machine_id").notNull(),
  childMachineId: uuid("child_machine_id").notNull(),
  depth: integer("depth").notNull(),
  status: text("status").default("running").notNull(),
  cost: real("cost").default(0).notNull(),
  createdAt: created(),
}, (t) => [index("mcr_parent_idx").on(t.parentRunId)]);

export const approvalRequests = pgTable("approval_requests", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  /** null for actions outside a Machine run (e.g. Machine Network hire). */
  machineRunId: uuid("machine_run_id").references(() => machineRuns.id, { onDelete: "cascade" }),
  kind: text("kind").default("tool").notNull(),
  toolExecutionId: uuid("tool_execution_id").references(() => toolExecutions.id, { onDelete: "set null" }),
  toolId: text("tool_id").notNull(),
  permission: text("permission").notNull(),
  risk: text("risk").notNull(),
  title: text("title").notNull(),
  destination: text("destination"),
  purpose: text("purpose").default("").notNull(),
  payloadSummary: text("payload_summary").default("").notNull(),
  arguments: jsonb("arguments").$type<Record<string, unknown>>(),
  status: text("status").default("pending").notNull(),
  decision: text("decision"),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at"),
  result: text("result"),
  createdAt: created(),
}, (t) => [index("approval_req_ws_idx").on(t.workspaceId, t.status), index("approval_req_run_idx").on(t.machineRunId)]);

export const workspaceIntegrations = pgTable("workspace_integrations", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  status: text("status").default("not_connected").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
  lastSuccessAt: timestamp("last_success_at"),
  lastErrorAt: timestamp("last_error_at"),
  lastError: text("last_error"),
  createdAt: created(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("ws_integration_slug_uq").on(t.workspaceId, t.slug)]);

/** Encrypted at rest (AES-256-GCM). Never selected by client-facing queries. */
export const integrationCredentials = pgTable("integration_credentials", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  integrationId: uuid("integration_id").notNull().references(() => workspaceIntegrations.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  hint: text("hint").default("").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("cred_integration_uq").on(t.integrationId)]);

export const machineLogs = pgTable("machine_logs", {
  id: id(),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  taskId: uuid("task_id"),
  runId: uuid("run_id").references(() => machineRuns.id, { onDelete: "cascade" }),
  toolExecutionId: uuid("tool_execution_id"),
  level: text("level").default("SYSTEM").notNull(),
  message: text("message").notNull(),
  createdAt: created(),
}, (t) => [index("logs_machine_idx").on(t.machineId, t.createdAt), index("logs_run_idx").on(t.runId)]);

export const arcStatus = pgEnum("arc_status", ["draft", "deployed", "running", "paused", "failed", "disabled"]);
export const arcRunStatus = pgEnum("arc_run_status", ["queued", "running", "waiting_approval", "waiting_delay", "completed", "failed", "cancelled"]);
export const arcNodeType = pgEnum("arc_node_type", ["trigger", "machine", "decision", "human_review", "delay", "output"]);
export const arcRunNodeStatus = pgEnum("arc_run_node_status", ["pending", "queued", "running", "waiting", "completed", "failed", "skipped"]);

export const arcs = pgTable("arcs", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  arcCode: text("arc_code").notNull().unique(),
  description: text("description").default("").notNull(),
  objective: text("objective").default("").notNull(),
  status: arcStatus("status").default("draft").notNull(),
  triggerType: text("trigger_type").default("manual").notNull(),
  triggerConfig: jsonb("trigger_config").$type<Record<string, string>>().default({}).notNull(),
  nodesCount: integer("nodes_count").default(0).notNull(),
  runsCompleted: integer("runs_completed").default(0).notNull(),
  successfulRuns: integer("successful_runs").default(0).notNull(),
  successRate: real("success_rate").default(0).notNull(),
  totalCost: real("total_cost").default(0).notNull(),
  totalDurationMs: integer("total_duration_ms").default(0).notNull(),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: text("last_run_status"),
  viewport: jsonb("viewport").$type<{ x: number; y: number; zoom: number }>(),
  deletedAt: timestamp("deleted_at"),
  createdAt: created(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [index("arcs_ws_idx").on(t.workspaceId, t.updatedAt)]);

export const arcNodes = pgTable("arc_nodes", {
  id: id(),
  arcId: uuid("arc_id").notNull().references(() => arcs.id, { onDelete: "cascade" }),
  nodeKey: text("node_key").notNull(),
  nodeType: arcNodeType("node_type").notNull(),
  label: text("label").notNull(),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
  positionX: real("position_x").default(0).notNull(),
  positionY: real("position_y").default(0).notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: created(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("arc_nodes_key_uq").on(t.arcId, t.nodeKey)]);

export const arcEdges = pgTable("arc_edges", {
  id: id(),
  arcId: uuid("arc_id").notNull().references(() => arcs.id, { onDelete: "cascade" }),
  edgeKey: text("edge_key").notNull(),
  sourceNodeKey: text("source_node_key").notNull(),
  targetNodeKey: text("target_node_key").notNull(),
  sourceHandle: text("source_handle"),
  targetHandle: text("target_handle"),
  label: text("label"),
  conditionType: text("condition_type"),
  createdAt: created(),
}, (t) => [index("arc_edges_arc_idx").on(t.arcId)]);

export const arcRuns = pgTable("arc_runs", {
  id: id(),
  number: serial("number").notNull(),
  arcId: uuid("arc_id").notNull().references(() => arcs.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  status: arcRunStatus("status").default("queued").notNull(),
  isTest: boolean("is_test").default(false).notNull(),
  source: text("source").default("operator").notNull(),
  triggerDepth: integer("trigger_depth").default(0).notNull(),
  triggerPayload: jsonb("trigger_payload").$type<{ input: string }>().notNull(),
  finalOutput: text("final_output"),
  graphSnapshot: jsonb("graph_snapshot").$type<{ nodes: unknown[]; edges: unknown[] }>().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms").default(0).notNull(),
  estimatedCost: real("estimated_cost").default(0).notNull(),
  cost: real("cost").default(0).notNull(),
  errorMessage: text("error_message"),
  failedNodeKey: text("failed_node_key"),
  lockUntil: timestamp("lock_until"),
  createdAt: created(),
}, (t) => [index("arc_runs_arc_idx").on(t.arcId, t.createdAt), index("arc_runs_ws_idx").on(t.workspaceId, t.createdAt)]);

export const arcRunNodes = pgTable("arc_run_nodes", {
  id: id(),
  arcRunId: uuid("arc_run_id").notNull().references(() => arcRuns.id, { onDelete: "cascade" }),
  arcNodeId: uuid("arc_node_id").references(() => arcNodes.id, { onDelete: "set null" }),
  nodeKey: text("node_key").notNull(),
  nodeType: text("node_type").notNull(),
  label: text("label").notNull(),
  status: arcRunNodeStatus("status").default("pending").notNull(),
  branch: text("branch"),
  inputPayload: jsonb("input_payload").$type<{ text?: string } & Record<string, unknown>>(),
  outputPayload: jsonb("output_payload").$type<{ text?: string; continued?: boolean; attempts?: unknown[] } & Record<string, unknown>>(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms").default(0).notNull(),
  cost: real("cost").default(0).notNull(),
  attempts: integer("attempts").default(0).notNull(),
  machineRunId: uuid("machine_run_id").references(() => machineRuns.id, { onDelete: "set null" }),
  machineTaskId: uuid("machine_task_id"),
  resumeAt: timestamp("resume_at"),
}, (t) => [uniqueIndex("arc_run_nodes_uq").on(t.arcRunId, t.nodeKey)]);

export const arcRunEvents = pgTable("arc_run_events", {
  id: id(),
  arcRunId: uuid("arc_run_id").notNull().references(() => arcRuns.id, { onDelete: "cascade" }),
  nodeKey: text("node_key"),
  type: text("type").notNull(),
  message: text("message").notNull(),
  createdAt: created(),
}, (t) => [index("arc_run_events_idx").on(t.arcRunId, t.createdAt)]);

export const arcApprovals = pgTable("arc_approvals", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  arcRunId: uuid("arc_run_id").notNull().references(() => arcRuns.id, { onDelete: "cascade" }),
  nodeKey: text("node_key").notNull(),
  kind: text("kind").default("review").notNull(),
  title: text("title").notNull(),
  reason: text("reason").default("").notNull(),
  data: text("data").default("").notNull(),
  status: text("status").default("pending").notNull(),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at"),
  createdAt: created(),
}, (t) => [index("arc_approvals_run_idx").on(t.arcRunId)]);

export const transactions = pgTable("transactions", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  fromName: text("from_name").notNull(),
  toName: text("to_name").notNull(),
  purpose: text("purpose").notNull(),
  amount: real("amount").notNull(),
  direction: text("direction").default("out").notNull(),
  kind: text("kind").default("hire").notNull(),
  status: text("status").default("complete").notNull(),
  createdAt: created(),
});

export const activities = pgTable("activities", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  actor: text("actor").notNull(),
  message: text("message").notNull(),
  severity: text("severity").default("info").notNull(),
  machineId: uuid("machine_id"),
  createdAt: created(),
}, (t) => [index("activities_ws_idx").on(t.workspaceId, t.createdAt)]);

export const usageRecords = pgTable("usage_records", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id"),
  tokens: integer("tokens").notNull(),
  cost: real("cost").notNull(),
  createdAt: created(),
}, (t) => [index("usage_ws_idx").on(t.workspaceId, t.createdAt)]);


// ============================================================================
// Phase 4 — Autonomous runtime: durable queue, schedules, webhooks, event triggers
// ============================================================================
export const jobStatus = pgEnum("job_status", ["queued", "running", "completed", "failed", "dead", "cancelled"]);

/** Durable job queue. Claimed with FOR UPDATE SKIP LOCKED; expired leases are reclaimed (crash recovery). */
export const jobs = pgTable("jobs", {
  id: id(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  status: jobStatus("status").default("queued").notNull(),
  priority: integer("priority").default(5).notNull(),
  runAt: timestamp("run_at").defaultNow().notNull(),
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  dedupeKey: text("dedupe_key"),
  lockedBy: text("locked_by"),
  lockedUntil: timestamp("locked_until"),
  lastError: text("last_error"),
  createdAt: created(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("jobs_claim_idx").on(t.status, t.runAt, t.priority),
  uniqueIndex("jobs_dedupe_active_uq").on(t.dedupeKey).where(sql`${t.status} in ('queued','running') and ${t.dedupeKey} is not null`),
  index("jobs_ws_idx").on(t.workspaceId, t.createdAt),
]);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: text("id").primaryKey(),
  host: text("host").default("").notNull(),
  mode: text("mode").default("in-process").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastBeatAt: timestamp("last_beat_at").defaultNow().notNull(),
  jobsProcessed: integer("jobs_processed").default(0).notNull(),
  jobsFailed: integer("jobs_failed").default(0).notNull(),
});

export const schedules = pgTable("schedules", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  targetType: text("target_type").notNull(), // machine | arc
  targetId: uuid("target_id").notNull(),
  kind: text("kind").default("interval").notNull(), // interval | cron
  intervalSec: integer("interval_sec"),
  cron: text("cron"),
  input: text("input").default("").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  overlap: text("overlap").default("skip").notNull(), // skip | queue
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  lastStatus: text("last_status"),
  runCount: integer("run_count").default(0).notNull(),
  failCount: integer("fail_count").default(0).notNull(),
  createdAt: created(),
}, (t) => [index("schedules_due_idx").on(t.enabled, t.nextRunAt), index("schedules_ws_idx").on(t.workspaceId), check("schedules_interval_chk", sql`${t.kind} <> 'interval' or ${t.intervalSec} >= 60`)]);

export const webhooks = pgTable("webhooks", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  tokenPrefix: text("token_prefix").notNull().unique(),
  tokenHash: text("token_hash").notNull(),
  inputTemplate: text("input_template").default("{{body}}").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  callCount: integer("call_count").default(0).notNull(),
  lastCalledAt: timestamp("last_called_at"),
  createdAt: created(),
}, (t) => [index("webhooks_ws_idx").on(t.workspaceId)]);

export const eventTriggers = pgTable("event_triggers", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(), // machine | arc
  sourceId: uuid("source_id").notNull(),
  onStatus: text("on_status").default("completed").notNull(), // completed | failed | any
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  inputTemplate: text("input_template").default("{{output}}").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  fireCount: integer("fire_count").default(0).notNull(),
  lastFiredAt: timestamp("last_fired_at"),
  createdAt: created(),
}, (t) => [index("event_triggers_src_idx").on(t.sourceType, t.sourceId, t.enabled)]);

/** Audit log of every automated start attempt. */
export const triggerFires = pgTable("trigger_fires", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // schedule | webhook | event
  sourceId: uuid("source_id"),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  status: text("status").notNull(), // started | skipped | failed
  reason: text("reason"),
  ref: text("ref"),
  createdAt: created(),
}, (t) => [index("trigger_fires_ws_idx").on(t.workspaceId, t.createdAt)]);

/** Alias matching the physical table name. */
export const profiles = users;

/** Server-only sliding windows; namespaced account/address keys are stored only as digests. */
export const sharedRateLimits = pgTable("shared_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  hits: timestamp("hits", { withTimezone: true }).array().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("shared_rate_limits_expiry_idx").on(t.expiresAt)]).enableRLS();
