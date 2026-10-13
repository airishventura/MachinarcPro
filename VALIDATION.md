# MachinArc acceptance check — 11 October 2026

## Live domain

Tested `https://machinarcpro.com` through HTTP requests to the deployed registration/login forms, published server actions, and Machine state endpoint. Browser interaction was not part of this check.

- Two new registered accounts provisioned separate workspaces.
- Wrong-password login rejected without creating a session.
- Successful login issued a Secure, HttpOnly, SameSite=Lax session cookie.
- Logout invalidated the session on the server.
- The owning account could read its Machine; the other account received 404, and anonymous access received 401.
- Cross-account task creation and approval were rejected.
- A mock task reached an approval wait, and the approval persisted across fresh state requests.
- Owner approval resumed the task through the existing hosted scheduler to completion.
- The recorded provider was mock, and the completed tool execution was explicitly simulated.
- Duplicate approval was rejected.
- Both temporary accounts, their workspaces, and sessions were removed after validation. Local test credentials were removed.
- Production catalog checks found no public tables without RLS and no public table grants to `anon` or `authenticated`.

## Disposable database

Ran `auth-integration`, `phase3`, `phase4`, and `runtime-recovery` against the separate `machinarc_test` database: **56 passed, 1 failed due to a database privilege requirement**.

Passing checks covered approval and denial, cross-workspace access, queue deduplication and concurrent claims, lease recovery, orphaned-run recovery, completed-tool result reuse, ambiguous-tool outcome failure without replay, approval recovery with queued sibling calls, and active-runtime limits across long approval waits.

The remaining RLS probe in `tests/phase4.test.ts` attempts to create a temporary database role. The configured test connection cannot create roles (`42501`). That probe remains unverified; no database privileges were expanded to make it pass. The production application uses server-side sessions and a private database connection, rather than client JWT access to the Data API.

## Remaining acceptance

- Run the RLS probe using an appropriately privileged connection to the disposable test database.
- Complete real-provider acceptance when an OpenAI or Anthropic key is available: a short task, deterministic tool call, then an approval scenario with output, usage, and cost verification.
- A forced hosted process interruption was not performed. Restart recovery was verified in the disposable database; hosted task scheduling and approval continuation were verified on the live domain.
- Conduct a user pilot after real-provider acceptance.

## Review follow-up — 11 October 2026

Source commit: `a1ba67ef746ae7334340485cb026954e553e9023` in `airishventura/MachinarcPro`.

- Published the existing workspace and fixes to GitHub. Local `main` matches the remote source commit. Environment files and local validation artifacts are ignored; a scan of tracked files found none of the configured private connection strings or secrets.
- Removed invented landing counters and random activity increments. The activity ticker and Network catalog now visibly identify examples as simulated.
- Catalog hires retain permission and approval checks, but return a simulated result without an external task, transaction or Credit debit. Approval results preserve the simulated outcome.
- Economy lifetime aggregates include every completed transaction independently of the latest-100 table. Real-provider cost estimates use run telemetry, exclude Mock Runtime, disclose unknown prices and remain in USD. Provider usage no longer debits internal Credits. Existing historical balances and records were preserved.
- Added three accounting/simulation regression tests. All pass against `machinarc_test`.
- Fixed the Arc builder's nested library component and effect-driven display overlays. Onboarding completion uses a storage subscription. Local full lint, typecheck and production build pass.
- The first concurrent local integration run passed 66 of 72 tests: the RLS probe lacked role-creation permission and five recovery tests failed in shared fixture setup. Rerunning recovery separately passed all five. Database suites now run sequentially to reduce connection contention.
- [GitHub Checks](https://github.com/airishventura/MachinarcPro/actions/runs/38156107977) passed all steps for the source commit: typecheck, lint, unit tests, the complete integration suite (including the RLS probe on disposable PostgreSQL), and production build. This closes the RLS acceptance gap without expanding the production server role.
- HTTP checks of the locally built homepage, Network, Economy and Arc editor returned 200 and the expected content. Authenticated checks used a temporary session and visitor workspace in the disposable test database; both were removed afterward. These checks do not establish browser interaction or visual correctness.
- Browser verification could not complete: initial preview startup was slow under memory pressure, and subsequent browser attachment/navigation attempts failed. Desktop/mobile visual, keyboard and hydration checks remain pending.
- No new production deployment or forced hosted process interruption was performed. A separate staging environment with a harmless action destination is required for disruptive hosted acceptance. The existing live site still requires deployment of these source changes.
- Real-provider acceptance was explicitly deferred by the operator. `PILOT.md` records the gates and session tasks; no participants or user findings are claimed.

## Protected staging acceptance — 14 October 2026

- Created the separate Vercel project `machinarc-staging`, with Vercel Authentication covering all deployments. The final preview is https://machinarc-staging-8lr7obloi-julienseven.vercel.app (`dpl_6RjA1MB1uGxPLo3E1XScWAVv4wfk`). The production project and its domains were not deployed or promoted.
- Applied both existing migrations to the separate `machinarc_staging` database. Its dedicated `machinarc_staging` login has application-table access only in staging; querying production profiles was rejected with PostgreSQL `42501`. All 35 staging tables have RLS enabled; public schema/table access is revoked. This is a separate database on the existing Supabase instance, not a separate infrastructure instance.
- Staging has independent encryption and worker secrets. The `machinarc-staging-worker-minute` cron job POSTs to this exact preview every minute, using credentials in Supabase Vault and a staging-only Vercel protection bypass. Update that job's destination when deploying a new staging URL. No AI provider key was added.
- Browser registration and onboarding passed with a disposable staging account. Desktop and 390×844 viewport checks covered navigation, the Machine builder, deployment, task submission, approval persistence after reload, and the tool inspector. Invalid credentials produced a visible error. Phone-width content did not overflow horizontally; the navigation menu opened.
- Found and fixed mobile run-inspector overflow: the timeline grid and usage panel can shrink at phone width and its wide table scrolls inside the panel. Its accessible label now references the heading.
- Found and fixed a native browser validation defect: the default $1 task limit conflicted with `min=0.01` and `step=0.05`. The field now accepts cent increments; its default has no step mismatch and proceeds to Review/deployment.
- Found and fixed hosted approval recovery: the UI previously failed an approved run with no persistent-worker heartbeat while it waited for a scheduler tick. Stale-run handling now uses workspace-scoped durable orphan recovery, preserving queued work and reconciling unfinished tools through the existing runtime.
- All seven targeted recovery tests passed, including queued approval preservation, orphan requeue, completed-tool reuse, unknown-outcome protection, approval siblings, and runtime deadlines. Typecheck and targeted lint passed. [GitHub Checks](https://github.com/airishventura/MachinarcPro/actions/runs/38442826922) passed the full checks for source commit `209c4c3cad2a7e14586901234d941b43a11bf2a2` on `codex/staging-acceptance`.
- Authenticated HTTP checks of the landing page, workspace, Network, Economy and builder returned 200. The worker returned 401 without its credential and 200 with it. After the fix, the browser retry completed through the minute scheduler after approvals for Web Search and Fetch Page; the calculator returned 28.5, output was explicitly labeled simulated, and workspace Credits stayed at 500. To exercise the stale-run threshold without a long artificial wait, the disposable retry's creation timestamp was backdated four minutes; its actual execution/approval timestamps were left intact.
- Forced hosted-process termination, real-provider acceptance and human pilot sessions remain separate pending gates. These staging checks use Mock Runtime and do not establish real-provider or marketplace execution.
