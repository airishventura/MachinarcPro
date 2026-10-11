# MachinArc

Install the locked dependencies with `npm ci`. Use Node.js 22 or newer.

Set `DATABASE_URL` in an ignored `.env.local` file, apply the Drizzle migrations to your application database, then run `npm run dev`. Set `MARC_ENCRYPTION_KEY` to a private random value of at least 32 characters before connecting real integrations. Never commit credentials.

## Checks

`npm run typecheck`, `npm run lint`, and `npm test` run static and database-independent checks. `npm run build` requires `DATABASE_URL`; disable workers during builds with `MARC_WORKER=off`.

Database integration tests use `npm run test:integration`. Set `TEST_DATABASE_URL` in an ignored `.env` file or the shell to a disposable database whose name contains a separate `test` or `testing` segment (for example, `machinarc_test`). Apply the SQL migrations in `drizzle/` in sequence to that database first. The runner rejects the application database, scopes fixtures to their own workspaces, and closes its connection pool when done. Do not point it at live data.

If test credentials are in `.env.local`, run `node --env-file=.env.local node_modules/tsx/dist/cli.mjs --conditions=react-server --test tests/phase3.test.ts tests/phase4.test.ts tests/runtime-recovery.test.ts tests/auth-integration.test.ts tests/trigger-idempotency.test.ts tests/shared-rate-limit.test.ts tests/demo-cleanup.test.ts`.

## Execution and demos

Run a dedicated worker with `npm run worker` where a continuously running process is available. Set `MARC_WORKER=off` on web processes when using dedicated workers.

Public demos receive separate workspaces, use the mock provider, cannot connect credentials, and start with schedules disabled. Old shared demo sessions are rejected. Visitor sessions expire seven days after creation; workers remove expired isolated visitor demos in bounded batches, preserving shared workspaces, registered identities, credentials, and active work.

Recovery completes unanswered tool calls and reuses durable results. An interrupted tool with an unknown outcome stops the run instead of replaying a possible external action. Check the destination before manually retrying such a run.

Login and visitor demo limits use PostgreSQL sliding windows shared across replicas and restarts. Keys are stored as digests; database failures block authentication and demo provisioning. Runtime/tool limits remain process-local.

## Vercel and Supabase

Use Supabase PostgreSQL as the server-side database with the existing Drizzle schema and application sessions. Use the transaction pooler connection string for Vercel; keep it private as `DATABASE_URL`. Enable RLS on application tables and revoke access from `anon` and `authenticated`: this app accesses data through its server connection, not the Supabase Data API.

Use a dedicated database role with access limited to application tables. Supply Supabase's trusted root certificate as `DATABASE_SSL_CA`; certificate verification remains enabled. The server role's RLS policies permit application queries, while application authorization enforces workspace ownership.

Set `MARC_WORKER=off` and a random `CRON_SECRET` in Vercel. Hosted instances automatically skip the persistent worker loop. A trusted scheduler must POST to `/api/internal/worker` with `Authorization: Bearer <CRON_SECRET>` once per minute. Each authenticated request advances schedules, recovers orphaned runs, and drains up to four jobs. Configure deployment-protection access for that scheduler where necessary. A deployment without this scheduler can accept tasks but will not execute them.

Function execution is bounded to 300 seconds. Keep task runtime and delegation within that budget; longer execution requires a dedicated worker. Supabase credentials, scheduler secrets, and integration encryption keys belong in ignored local files or Vercel secret variables.

The connected Supabase project runs `machinarc-worker-minute` through `pg_cron` and `pg_net`. Its worker credential and Vercel scheduler access token are stored in Vault. Rotate those Vault values alongside their matching deployment secrets.

## Real provider acceptance

Real AI execution requires an OpenAI or Anthropic API key. Add it through Settings → Integrations in a registered workspace, then configure a Machine to use that provider and an available model. Demo workspaces always use Mock Runtime.

Start with a short task and no external action tools. Inspect its run to confirm the requested provider, output, usage, and cost are recorded without a mock fallback. Then enable a calculator tool and verify its request and result appear in telemetry. Validate any action that requires approval separately before connecting destinations with real effects. No real-provider acceptance test has been completed yet.

## Network and accounting

The public Network catalog is a demonstration: its Machines, owners, ratings, task counts and prices are examples. Simulated hires check permissions and approval behavior but never execute another Machine, create a transaction or deduct Credits. Delegation to actual Machines within a workspace uses the existing runtime separately.

Economy totals cover all completed Credit transactions; the table shows the latest 100. Real-provider USD estimates come from run telemetry, exclude Mock Runtime, disclose unpriced records, and neither debit internal Credits nor offset net Credits. Existing historical Credit records and balances are preserved. Provider estimates are not invoices or a currency conversion.

GitHub Checks runs static checks, unit tests, a production build and the integration suite against a disposable PostgreSQL service with the privileges required by the rolled-back RLS probe. See `PILOT.md` for pilot gates and session tasks.
