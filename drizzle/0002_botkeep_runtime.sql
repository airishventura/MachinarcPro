ALTER TABLE "arc_runs" ADD COLUMN "lock_owner" text;--> statement-breakpoint
ALTER TABLE "machine_runs" ADD COLUMN "lock_owner" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_stale_lease_idx" ON "jobs" USING btree ("locked_until") WHERE "jobs"."status" = 'running';