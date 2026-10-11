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
