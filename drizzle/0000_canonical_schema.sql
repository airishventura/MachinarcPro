CREATE TYPE "public"."arc_node_type" AS ENUM('trigger', 'machine', 'decision', 'human_review', 'delay', 'output');--> statement-breakpoint
CREATE TYPE "public"."arc_run_node_status" AS ENUM('pending', 'queued', 'running', 'waiting', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."arc_run_status" AS ENUM('queued', 'running', 'waiting_approval', 'waiting_delay', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."arc_status" AS ENUM('draft', 'deployed', 'running', 'paused', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."machine_status" AS ENUM('draft', 'initializing', 'running', 'idle', 'paused', 'failed');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'initializing', 'running', 'waiting_approval', 'waiting_tool', 'completed', 'failed', 'cancelled', 'budget_exceeded', 'timeout');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category" text NOT NULL,
	"actor" text NOT NULL,
	"message" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"machine_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"machine_run_id" uuid,
	"kind" text DEFAULT 'tool' NOT NULL,
	"tool_execution_id" uuid,
	"tool_id" text NOT NULL,
	"permission" text NOT NULL,
	"risk" text NOT NULL,
	"title" text NOT NULL,
	"destination" text,
	"purpose" text DEFAULT '' NOT NULL,
	"payload_summary" text DEFAULT '' NOT NULL,
	"arguments" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp,
	"result" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arc_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"arc_run_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"kind" text DEFAULT 'review' NOT NULL,
	"title" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"data" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arc_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arc_id" uuid NOT NULL,
	"edge_key" text NOT NULL,
	"source_node_key" text NOT NULL,
	"target_node_key" text NOT NULL,
	"source_handle" text,
	"target_handle" text,
	"label" text,
	"condition_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arc_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arc_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"node_type" "arc_node_type" NOT NULL,
	"label" text NOT NULL,
	"machine_id" uuid,
	"position_x" real DEFAULT 0 NOT NULL,
	"position_y" real DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arc_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arc_run_id" uuid NOT NULL,
	"node_key" text,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arc_run_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arc_run_id" uuid NOT NULL,
	"arc_node_id" uuid,
	"node_key" text NOT NULL,
	"node_type" text NOT NULL,
	"label" text NOT NULL,
	"status" "arc_run_node_status" DEFAULT 'pending' NOT NULL,
	"branch" text,
	"input_payload" jsonb,
	"output_payload" jsonb,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"machine_run_id" uuid,
	"machine_task_id" uuid,
	"resume_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "arc_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"arc_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" "arc_run_status" DEFAULT 'queued' NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'operator' NOT NULL,
	"trigger_depth" integer DEFAULT 0 NOT NULL,
	"trigger_payload" jsonb NOT NULL,
	"final_output" text,
	"graph_snapshot" jsonb NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"error_message" text,
	"failed_node_key" text,
	"lock_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"arc_code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"status" "arc_status" DEFAULT 'draft' NOT NULL,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"nodes_count" integer DEFAULT 0 NOT NULL,
	"runs_completed" integer DEFAULT 0 NOT NULL,
	"successful_runs" integer DEFAULT 0 NOT NULL,
	"success_rate" real DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	"total_duration_ms" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp,
	"last_run_status" text,
	"viewport" jsonb,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "arcs_arc_code_unique" UNIQUE("arc_code")
);
--> statement-breakpoint
CREATE TABLE "event_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"on_status" text DEFAULT 'completed' NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"input_template" text DEFAULT '{{output}}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"fire_count" integer DEFAULT 0 NOT NULL,
	"last_fired_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"dedupe_key" text,
	"locked_by" text,
	"locked_until" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "machine_call_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_run_id" uuid NOT NULL,
	"child_run_id" uuid,
	"parent_machine_id" uuid NOT NULL,
	"child_machine_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"tool_execution_id" uuid,
	"level" text DEFAULT 'SYSTEM' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"workspace_id" uuid,
	"kind" text DEFAULT 'fact' NOT NULL,
	"content" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"source" text DEFAULT 'operator' NOT NULL,
	"source_run_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_accessed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memories_importance_chk" CHECK ("machine_memories"."importance" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "machine_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"mode" text DEFAULT 'ASK' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"model" text DEFAULT 'mock-runtime' NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"ai_cost" real DEFAULT 0 NOT NULL,
	"tool_cost" real DEFAULT 0 NOT NULL,
	"child_cost" real DEFAULT 0 NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"pricing_known" boolean DEFAULT true NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"parent_run_id" uuid,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_tool_call" jsonb,
	"approved_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"lock_until" timestamp,
	"error" text,
	"error_kind" text,
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"machine_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"input" text NOT NULL,
	"output" text,
	"result" jsonb,
	"parent_task_id" uuid,
	"trigger_depth" integer DEFAULT 0 NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'operator' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "machine_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"permission" text DEFAULT 'READ' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"machine_code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"success_criteria" text DEFAULT '' NOT NULL,
	"status" "machine_status" DEFAULT 'draft' NOT NULL,
	"machine_type" text DEFAULT 'research' NOT NULL,
	"model_provider" text DEFAULT 'mock' NOT NULL,
	"model_name" text DEFAULT 'mock-runtime' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"temperature" real DEFAULT 0.4 NOT NULL,
	"reasoning" text DEFAULT 'medium' NOT NULL,
	"context_limit" integer DEFAULT 32000 NOT NULL,
	"memory_mode" text DEFAULT 'session' NOT NULL,
	"output_mode" text DEFAULT 'text' NOT NULL,
	"output_schema" jsonb,
	"max_turns" integer DEFAULT 8 NOT NULL,
	"max_tool_calls" integer DEFAULT 12 NOT NULL,
	"max_runtime_sec" integer DEFAULT 180 NOT NULL,
	"memory_config" jsonb,
	"triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"daily_budget" real DEFAULT 10 NOT NULL,
	"monthly_budget" real DEFAULT 150 NOT NULL,
	"max_task_cost" real DEFAULT 1 NOT NULL,
	"approval_above" real DEFAULT 5 NOT NULL,
	"allow_m2m" boolean DEFAULT false NOT NULL,
	"current_task" text,
	"reputation_score" real DEFAULT 80 NOT NULL,
	"success_rate" real DEFAULT 0 NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"successful_tasks" integer DEFAULT 0 NOT NULL,
	"tasks_failed" integer DEFAULT 0 NOT NULL,
	"total_runtime_ms" integer DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	"total_revenue" real DEFAULT 0 NOT NULL,
	"last_active_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "machines_machine_code_unique" UNIQUE("machine_code"),
	CONSTRAINT "machines_budget_chk" CHECK ("machines"."daily_budget" >= 0 AND "machines"."monthly_budget" >= "machines"."daily_budget")
);
--> statement-breakpoint
CREATE TABLE "run_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_run_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"tool_execution_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_run_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cost" real,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"finish_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text DEFAULT 'interval' NOT NULL,
	"interval_sec" integer,
	"cron" text,
	"input" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"overlap" text DEFAULT 'skip' NOT NULL,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"last_status" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_interval_chk" CHECK ("schedules"."kind" <> 'interval' or "schedules"."interval_sec" >= 60)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"machine_run_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"permission" text,
	"permission_decision" text,
	"risk" text DEFAULT 'low' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"input_payload" jsonb,
	"output_payload" jsonb,
	"output_preview" text,
	"error" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_name" text NOT NULL,
	"to_name" text NOT NULL,
	"purpose" text NOT NULL,
	"amount" real NOT NULL,
	"direction" text DEFAULT 'out' NOT NULL,
	"kind" text DEFAULT 'hire' NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_fires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"machine_id" uuid,
	"tokens" integer NOT NULL,
	"cost" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"google_id" text,
	"onboarded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"input_template" text DEFAULT '{{body}}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"last_called_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_token_prefix_unique" UNIQUE("token_prefix")
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'in-process' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_beat_at" timestamp DEFAULT now() NOT NULL,
	"jobs_processed" integer DEFAULT 0 NOT NULL,
	"jobs_failed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_success_at" timestamp,
	"last_error_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'operator' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'PRO' NOT NULL,
	"credits" real DEFAULT 500 NOT NULL,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_machine_run_id_machine_runs_id_fk" FOREIGN KEY ("machine_run_id") REFERENCES "public"."machine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tool_execution_id_tool_executions_id_fk" FOREIGN KEY ("tool_execution_id") REFERENCES "public"."tool_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_approvals" ADD CONSTRAINT "arc_approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_approvals" ADD CONSTRAINT "arc_approvals_arc_run_id_arc_runs_id_fk" FOREIGN KEY ("arc_run_id") REFERENCES "public"."arc_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_approvals" ADD CONSTRAINT "arc_approvals_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_edges" ADD CONSTRAINT "arc_edges_arc_id_arcs_id_fk" FOREIGN KEY ("arc_id") REFERENCES "public"."arcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_nodes" ADD CONSTRAINT "arc_nodes_arc_id_arcs_id_fk" FOREIGN KEY ("arc_id") REFERENCES "public"."arcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_nodes" ADD CONSTRAINT "arc_nodes_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_run_events" ADD CONSTRAINT "arc_run_events_arc_run_id_arc_runs_id_fk" FOREIGN KEY ("arc_run_id") REFERENCES "public"."arc_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_run_nodes" ADD CONSTRAINT "arc_run_nodes_arc_run_id_arc_runs_id_fk" FOREIGN KEY ("arc_run_id") REFERENCES "public"."arc_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_run_nodes" ADD CONSTRAINT "arc_run_nodes_arc_node_id_arc_nodes_id_fk" FOREIGN KEY ("arc_node_id") REFERENCES "public"."arc_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_run_nodes" ADD CONSTRAINT "arc_run_nodes_machine_run_id_machine_runs_id_fk" FOREIGN KEY ("machine_run_id") REFERENCES "public"."machine_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_runs" ADD CONSTRAINT "arc_runs_arc_id_arcs_id_fk" FOREIGN KEY ("arc_id") REFERENCES "public"."arcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_runs" ADD CONSTRAINT "arc_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcs" ADD CONSTRAINT "arcs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_triggers" ADD CONSTRAINT "event_triggers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_integration_id_workspace_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."workspace_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_call_relationships" ADD CONSTRAINT "machine_call_relationships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_call_relationships" ADD CONSTRAINT "machine_call_relationships_parent_run_id_machine_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."machine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_call_relationships" ADD CONSTRAINT "machine_call_relationships_child_run_id_machine_runs_id_fk" FOREIGN KEY ("child_run_id") REFERENCES "public"."machine_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_logs" ADD CONSTRAINT "machine_logs_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_logs" ADD CONSTRAINT "machine_logs_run_id_machine_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."machine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_memories" ADD CONSTRAINT "machine_memories_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_memories" ADD CONSTRAINT "machine_memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_permissions" ADD CONSTRAINT "machine_permissions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_task_id_machine_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."machine_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_tasks" ADD CONSTRAINT "machine_tasks_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_tasks" ADD CONSTRAINT "machine_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_tools" ADD CONSTRAINT "machine_tools_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sources" ADD CONSTRAINT "run_sources_machine_run_id_machine_runs_id_fk" FOREIGN KEY ("machine_run_id") REFERENCES "public"."machine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sources" ADD CONSTRAINT "run_sources_tool_execution_id_tool_executions_id_fk" FOREIGN KEY ("tool_execution_id") REFERENCES "public"."tool_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_usage" ADD CONSTRAINT "run_usage_machine_run_id_machine_runs_id_fk" FOREIGN KEY ("machine_run_id") REFERENCES "public"."machine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_machine_run_id_machine_runs_id_fk" FOREIGN KEY ("machine_run_id") REFERENCES "public"."machine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_fires" ADD CONSTRAINT "trigger_fires_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_integrations" ADD CONSTRAINT "workspace_integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_ws_idx" ON "activities" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_req_ws_idx" ON "approval_requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "approval_req_run_idx" ON "approval_requests" USING btree ("machine_run_id");--> statement-breakpoint
CREATE INDEX "arc_approvals_run_idx" ON "arc_approvals" USING btree ("arc_run_id");--> statement-breakpoint
CREATE INDEX "arc_edges_arc_idx" ON "arc_edges" USING btree ("arc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "arc_nodes_key_uq" ON "arc_nodes" USING btree ("arc_id","node_key");--> statement-breakpoint
CREATE INDEX "arc_run_events_idx" ON "arc_run_events" USING btree ("arc_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "arc_run_nodes_uq" ON "arc_run_nodes" USING btree ("arc_run_id","node_key");--> statement-breakpoint
CREATE INDEX "arc_runs_arc_idx" ON "arc_runs" USING btree ("arc_id","created_at");--> statement-breakpoint
CREATE INDEX "arc_runs_ws_idx" ON "arc_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "arcs_ws_idx" ON "arcs" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "event_triggers_src_idx" ON "event_triggers" USING btree ("source_type","source_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "cred_integration_uq" ON "integration_credentials" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_active_uq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."status" in ('queued','running') and "jobs"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "jobs_ws_idx" ON "jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "mcr_parent_idx" ON "machine_call_relationships" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "logs_machine_idx" ON "machine_logs" USING btree ("machine_id","created_at");--> statement-breakpoint
CREATE INDEX "logs_run_idx" ON "machine_logs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "memories_machine_idx" ON "machine_memories" USING btree ("machine_id","created_at");--> statement-breakpoint
CREATE INDEX "perms_machine_idx" ON "machine_permissions" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "runs_task_idx" ON "machine_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "runs_machine_idx" ON "machine_runs" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "tasks_machine_idx" ON "machine_tasks" USING btree ("machine_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_ws_idx" ON "machine_tasks" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "tools_machine_idx" ON "machine_tools" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "machines_ws_idx" ON "machines" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "machines_ws_status_idx" ON "machines" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "run_sources_uq" ON "run_sources" USING btree ("machine_run_id","url");--> statement-breakpoint
CREATE INDEX "run_usage_run_idx" ON "run_usage" USING btree ("machine_run_id");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "schedules_ws_idx" ON "schedules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "toolexec_run_idx" ON "tool_executions" USING btree ("machine_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "toolexec_call_uq" ON "tool_executions" USING btree ("machine_run_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "trigger_fires_ws_idx" ON "trigger_fires" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_ws_idx" ON "usage_records" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "webhooks_ws_idx" ON "webhooks" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ws_integration_slug_uq" ON "workspace_integrations" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "workspace_members" USING btree ("user_id");