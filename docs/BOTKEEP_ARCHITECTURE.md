# Persistent execution on Botkeep

## Existing architecture and boundaries

MachinArc uses Next.js 16.2.6, React 19.2.6, Node.js 22+, npm, Drizzle 0.45.2 and PostgreSQL (`pg` 8.20.0). Vercel serves the dashboard, server actions, authentication and lightweight API routes. Supabase PostgreSQL stores the existing application sessions, workspace memberships, Machines, runs, tool telemetry, credentials, jobs and schedules. Authentication currently uses application sessions, not Supabase Auth; this change preserves it. Browser telemetry already polls authenticated APIs; no new Realtime subscription or UI redesign is needed.

The existing `MachineRuntime`, `ArcRuntime`, `jobs`, `worker_heartbeats`, `schedules`, `trigger_fires`, webhook token hashes and structured redacted logs remain the execution system. Botkeep supplies persistent Node.js processes; it does not become the frontend or primary database. No Redis or extra queue dependency is introduced.

## Execution flow

1. The Run server action authenticates the operator and checks workspace ownership. The new `POST /api/machines/:id/run` uses the same submission service, requires the session cookie and same-origin `Origin`, and accepts `{ "input": "Describe the task" }`.
2. A short database transaction serializes submissions for the Machine and creates the task, run and queue job together. The API returns HTTP 202 with `{ "runId": "...", "status": "queued" }`.
3. The worker atomically claims due jobs using `FOR UPDATE SKIP LOCKED`. It rechecks the job workspace against its target before invoking the existing runtime.
4. The runtime persists messages, tool results, approvals, usage, output and status. Closing the browser has no effect on execution. The dashboard continues polling persisted telemetry.

Existing status enums are preserved: jobs use `queued`, `running`, `completed`, `dead`; Machine runs use `queued`, `initializing`, `running`, `waiting_tool`, `waiting_approval`, `completed`, `failed`, `cancelled`, `timeout`, `budget_exceeded`. Claim/retry states and attempts live in `jobs`, rather than adding incompatible run statuses.

## Services and start commands

All services use the repository root. Install with `npm ci --include=dev`: `tsx` is an existing development dependency used by these runtime entry points. No Next.js build is required for Botkeep services.

| Botkeep slot | Service | Start command | Local default health port |
| --- | --- | --- | --- |
| 1 | machinarc-worker (worker + shared runtime) | `npm run worker` | 3101 |
| 2 | machinarc-scheduler | `npm run scheduler` | 3102 |
| 3 | machinarc-integrations | `npm run integrations` | 3103 |
| 4–5 | Reserved for staging / future worker / Redis if later justified | — | — |

This is the requested Founder Free deployment layout, not a claim about the account's current available resources. Begin with worker concurrency 2. Reduce it to 1 if the assigned shared CPU/RAM requires it; measure memory and connection usage before adding workers. Logical runtime boundaries remain in `src/lib/runtime`; it does not need a fourth service.

The dedicated worker executes jobs and handles orphan recovery/demo retention; schedule ticking is disabled in that process. The independent scheduler advances persisted due schedules and enqueues their fires. The integrations process exposes the existing generic token-authenticated hook at `POST /hooks/:token` and `POST /api/hooks/:token`; it returns 202 and never executes a Machine inline. Vercel's existing webhook route calls the same helper and remains compatible. GitHub, Slack, Discord and Telegram signed-event adapters are not added because none are configured in the existing application.

## Database migration

Apply `drizzle/0002_botkeep_runtime.sql` once, after `0000_canonical_schema.sql` and `0001_shared_rate_limits.sql`, before deploying the new code. It adds nullable `lock_owner` to Machine/Arc runs, `timezone` to schedules with default `UTC`, and a partial stale-job index. It does not replace tables, delete data, alter status enums or change existing RLS grants. All additions are compatible with previous rows.

Drizzle is this repository's established migration history; these PostgreSQL migrations run on Supabase. Keep this single source of migration history rather than creating a second independent Supabase CLI history for the same tables. Use the existing Drizzle migration workflow, or execute the reviewed SQL in Supabase's SQL editor/with a trusted server connection and record it in the established migration history. Back up the application database first. Do not reapply the canonical schema to a populated database.

The worker, scheduler and ingress use a private server database role and the same `MARC_ENCRYPTION_KEY` as the web app. Keep `anon`/`authenticated` access revoked as in `supabase/rls.sql`; authorization happens on the server through workspace sessions. Prefer Supabase's session pooler/direct connection for persistent services and transaction pooler for Vercel. Pool size remains 5 per process. Supply the trusted root certificate as `DATABASE_SSL_CA`; do not disable certificate validation.

## Environment

Copy `.env.example` to an ignored `.env` for local service development, or inject variables into each Botkeep service's Environment settings. Do not copy Vercel's `VERCEL` variable into Botkeep. Services validate required settings before importing database code.

| Variable | Scope/default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required, private | Server-role Supabase PostgreSQL URL; never user-supplied |
| `DATABASE_SSL_CA` | When TLS CA is required | Trusted database CA |
| `MARC_ENCRYPTION_KEY` | Required, minimum 32 characters | Same private credential encryption key as Vercel |
| `MARC_WORKER` | `off` on Vercel/web | Disable the optional in-process web worker |
| `MACHINARC_EXECUTION_MODE` | `botkeep` after cutover | Disable web in-process execution and make the legacy authenticated HTTP drain a no-op; unset preserves its existing fallback |
| `MACHINARC_WORKER_CONCURRENCY` | `2` | Worker claim capacity, range 1–16; legacy `MARC_WORKER_CONCURRENCY` remains supported |
| `MACHINARC_POLL_INTERVAL_MS` | `3000` | Worker poll interval, range 500–60000 |
| `MACHINARC_SCHEDULER_POLL_INTERVAL_MS` | `10000` | Scheduler poll interval, range 1000–60000 |
| `MACHINARC_JOB_LEASE_SECONDS` | `120` | Job lease, range 30–3600; renewed every lease/3 |
| `MACHINARC_SHUTDOWN_TIMEOUT_MS` | `30000` | Drain deadline before forced exit; up to 900000 |
| `SERVER_PORT` | Botkeep Network allocation | Overrides `PORT`; local defaults are service-specific |
| `HOST` | `0.0.0.0` in production, `127.0.0.1` locally | Listening interface |
| `TZ` | `UTC` (set by service entry points) | Interpret existing zone-less database timestamps consistently |
| `CRON_SECRET` | Existing Vercel fallback only | Authenticates the old bounded HTTP worker route |
| `TEST_DATABASE_URL` | Tests only | Separate disposable PostgreSQL database with `test` in its name |

Provider integrations stay in the existing encrypted workspace configuration; optional platform provider keys retain their existing behavior. Local ChatGPT plan sign-in remains local-only and is unavailable in hosted Botkeep production. Hosted execution needs an existing supported provider API integration; no account credentials or ChatGPT tokens are exported to Botkeep.

## Local development and verification

Run the web app with `MARC_WORKER=off`, then run `npm run worker`, `npm run scheduler` and optionally `npm run integrations` in separate terminals, with distinct ports. Each command loads ignored `.env` using dotenv. To use separate files, set `DOTENV_CONFIG_PATH` per process. Database fixtures must use a separate disposable test database.

Required checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `MARC_WORKER=off npm run build` (set the environment variable using your shell). Apply all migrations to the disposable database before integration tests. Tests cover queue submission, ownership, competing claims, attempts/lease fencing, completion, bounded recovery, schedules, webhook enqueue and runtime lock takeover. Unit tests cover timezone/DST behavior and bounded webhook input.

For runtime acceptance, start the services, check `/health`, submit a short mock Machine task, close the caller, and inspect its persisted completed run. Then verify a due schedule and webhook produce queued work. Run real-provider and external-action acceptance separately with deliberate destinations and operator approvals.

## Botkeep deployment

1. Import `airishventura/MachinarcPro` from GitHub, select the reviewed/merged revision, project root `.` and an enabled Node.js 22 runtime. The repository lockfile is authoritative.
2. Configure dependency installation as `npm ci --include=dev` and one of the start commands above. If the panel provides only one command field, use `npm ci --include=dev && npm run worker` (or scheduler/integrations). Prefer installing once per revision where the panel supports it.
3. Set private database/encryption values through Environment, `NODE_ENV=production`, `HOST=0.0.0.0`, and the actual allocated `SERVER_PORT` from Network. Do not hardcode an invented public port or domain.
4. Apply the additive database migration, start worker first, check its Console and `GET /health`, then start scheduler and ingress with the same database/encryption configuration. Give ingress a Domains/TLS route only if external hooks will use it. Worker and scheduler health need not be public.
5. Confirm an actual queued run completes and its logs show `jobId`, `workerId`, `attempt`, and run/Machine IDs where available. No secrets or tool payloads belong in logs.
6. After Botkeep acceptance passes, set `MACHINARC_EXECUTION_MODE=botkeep` and `MARC_WORKER=off` on Vercel and disable the existing Supabase `machinarc-worker-minute` pg_cron HTTP drain. The mode switch makes even lingering authenticated cron deliveries return immediately without executing runs. Unset the mode to restore the previous bounded fallback if Botkeep is unavailable. Keep the Vercel frontend deployment and Supabase database in place.

Botkeep's official guides describe GitHub root/start command configuration, Environment secrets, and listening on `0.0.0.0`/`SERVER_PORT`: [GitHub deployment](https://botkeep.cloud/docs/github), [hosting](https://botkeep.cloud/docs/hosting). This repository adds explicit commands; it does not invent an unsupported Botkeep manifest or deployment API.

## Health, shutdown, retry and recovery

`GET /health` checks database reachability and returns `{ "status": "ok", "service": "machinarc-worker" }` (or scheduler/integrations). Dependency failure returns 503. The endpoint is a dependency probe; it does not establish provider availability or end-to-end acceptance.

SIGINT/SIGTERM stops new claims, waits for polling and in-flight jobs while heartbeats continue, then closes HTTP and database connections. If the drain deadline expires, exit leaves persisted leases for recovery. No queued state depends on process memory.

Queue ownership is fenced by worker ID, attempt, status and unexpired lease. Runtime ownership additionally uses a UUID `lock_owner`, periodic renewal and guarded writes; losing a lease aborts provider/tools and prevents the old driver from releasing a newer owner's lock. Expired claims count toward the bounded retry budget. Failures retry with the existing backoff (10s, 40s, 160s); exhausted work dead-letters. Contention with a still-live runtime driver defers delivery until its lease expires without charging a failed attempt. Orphan recovery does not reset a dead job's attempt budget, and surfaces abandoned runs as failed while preserving fresh owners.

Recovery resumes persisted messages and known tool outcomes. Unknown interrupted external tool outcomes stop the run for operator inspection; they are never blindly replayed. Runtime business/provider failures remain terminal run outcomes; queue retries resume delivery/infrastructure interruptions, not a brand-new task. Exact-once external effects require destination idempotency support. Inspect any uncertain external effect before starting a new task or using the existing dead-job retry control.

Schedules are database-backed: claiming due rows, advancing `last_run_at`/`next_run_at`, and creating deduplicated fires share one transaction. Existing schedules default UTC. New schedules may provide an IANA timezone through the existing server action; the current UI continues UTC. Missing DST wall-clock minutes are skipped; both real occurrences of a repeated minute are eligible. Missed intervals coalesce into one due fire rather than generating an unbounded backlog.

## Scaling and limits

Local verification on 2026-10-15: typecheck, lint, production build, 47 unit tests and 89 database integration tests passed. A production Next.js HTTP smoke check confirmed 202 queue-only submission with no web worker, followed by independent worker completion after the caller connection closed. Separate scheduler and integrations processes also produced completed mock runs; all three health endpoints returned 200. Missing session, foreign origin/workspace and oversized body checks returned 401, 403, 400 and 413 respectively. The legacy HTTP drain returned immediately in Botkeep mode. The local application database was backed up before the additive migration, with existing run and schedule counts preserved. These checks used local PostgreSQL and the mock provider, not a hosted Botkeep instance or real-provider credentials.

Increase worker concurrency cautiously, then add another worker when measured CPU/RAM and database connection limits allow. Claims and receipt transactions protect multiple workers/schedulers. The queue abstraction in `src/lib/queue` can later be replaced without copying the runtime. Keep Vercel API work short.

Current limits: no Botkeep deployment or production migration is implied by committed configuration; platform account capacity, TLS routing, provider credentials and hosted crash acceptance must be verified on the actual deployment. Generic webhook token auth is reused; provider-specific signature adapters await actual integrations. Existing generic hook rate limits are process-local. Runtime leases reduce duplicate drivers, but cannot guarantee exactly-once effects at third-party destinations.
