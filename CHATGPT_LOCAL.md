# Local ChatGPT AI provider

Implemented and connected for the local development app. Real ChatGPT inference and tool approval/resume have been verified; production has not been deployed with this integration.

## Prepared on this computer

An isolated PostgreSQL 18.6 cluster is installed in the ignored `.validation/postgres-local` folder and listens only on `127.0.0.1:55432`. The `machinarc_local` database has both existing migrations applied. Its application role is not a superuser and cannot create roles or databases. Database and encryption credentials are saved in the ignored `.env.chatgpt.local` file.

`npm.cmd run dev:chatgpt` starts the bundled database when needed and serves MachinArc at http://127.0.0.1:3016. The local account is `airish.local@example.invalid`; its password is in the ignored `.validation/local-login.json` file. Preserve the database directory and encryption key to retain your Machines and ChatGPT connections.

PostgreSQL initially failed in the old Windows C++ runtime. Verified, signed runtime DLLs already bundled with Codex were copied beside the PostgreSQL binaries. Windows system DLLs and services were not modified.

## Run locally

1. Install or use PostgreSQL, create a separate `machinarc_local` database, and apply the SQL migrations in `drizzle/` in filename order using your PostgreSQL client. Do not use the production or shared staging database. A PostgreSQL service or Docker was not detected on this computer during implementation.
2. Create the ignored `.env.chatgpt.local` file with its `DATABASE_URL`. Use a database on `127.0.0.1`/`localhost`, or an isolated remote database named `machinarc_local`. If the latter needs a CA, add `DATABASE_SSL_CA` using the existing environment format.
3. Run `npm.cmd run dev:chatgpt`. The launcher creates an encryption key in that local configuration when missing. Keep this key: it is needed to decrypt saved connections. It binds the application to `127.0.0.1:3016`, starts the local worker, and overrides production provider/worker secrets that Next would otherwise load from `.env.local`.
4. Open http://127.0.0.1:3016 and sign in to a personal MachinArc workspace with one owner/member. Demo workspaces cannot connect credentials.
5. Open Settings → Integrations → Continue with ChatGPT. Complete OpenAI sign-in and grant ChatGPT plan permission yourself. Eligible account access and available models are determined by OpenAI.
6. Create a new Machine and select ChatGPT · local plus a model from the account catalog. Tool permissions and approval/resume remain controlled by MachinArc.

The launcher does not create or migrate a database. It deliberately uses `.env.chatgpt.local` rather than taking `DATABASE_URL` from the production `.env.local` configuration.

Example configuration (replace both placeholders with your local PostgreSQL credentials; these are not supplied accounts):

```dotenv
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/machinarc_local
```

Run from the repository directory:

```powershell
npm.cmd run dev:chatgpt
```

For independent local execution, start the web app with `npm.cmd run dev:chatgpt -- --separate-worker`, then run `node scripts/local-chatgpt.cjs --worker` in a second terminal. The worker uses the same isolated database and protected ChatGPT connection, remains in development mode, and exposes health only at `http://127.0.0.1:3101/health`. Closing the browser or stopping the web app does not stop this separate worker. Both processes must remain on this computer; no hosted service is involved.

The database must also use UTC for the queue's zone-less timestamps. On a new local database, run `ALTER DATABASE machinarc_local SET timezone TO 'UTC';` as its administrator, then reconnect the app and worker. The launcher sets the Node.js timezone to UTC. Do not change an existing database's timezone without checking its previously scheduled timestamps.

## Credential and account behavior

OAuth uses PKCE, state, a nonce, a signed/validated ID token, and the exact loopback callback `/auth/callback`. Authorization attempts expire after ten minutes and cannot be replayed. Restarting the app during sign-in requires starting a fresh attempt.

Credentials are encrypted with AES-256-GCM and written atomically under `%USERPROFILE%\.machinarc\chatgpt` on Windows (or `~/.machinarc/chatgpt` elsewhere). They are scoped to the MachinArc workspace and issued ChatGPT client registration. They are not written to PostgreSQL, browser storage, or the repository. `MARC_CHATGPT_LOCAL_DIR` can select a different protected local directory.

Returning sign-in reuses the issued client registration and stable host identifier. The account selector can reauthorize a saved registration; Use a different ChatGPT account registers another. An existing active connection is preserved when sign-in fails or consent is declined. Account selection becomes active only after identity and plan permission have been validated.

The local app and worker serialize token refresh through a filesystem lock. If the process crashes while holding a lock, stop both the app and worker before removing the affected `.lock` file from the credential directory, then restart. Never remove another running process's lock.

Disconnect attempts remote session revocation and removes the selected account's local tokens. If revocation cannot be confirmed, Settings instructs the user to disconnect MachinArc in ChatGPT Settings. Previously saved registrations remain available for reauthorization.

## Inference and limits

The provider uses the public Responses API with `store: false`, `stream: true`, full tool history, and namespaced function tools. It accepts output/tool calls only after a completed terminal event. An incomplete or interrupted stream never executes its proposed tools.

Token usage is recorded; estimated API cost is unknown for ChatGPT plan usage. MachinArc's dollar budget is not an OpenAI plan limit. Review the connected app's allowance and credit settings in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage).

This provider is disabled unless `MARC_CHATGPT_LOCAL=1`, a non-production database configuration and explicit encryption key are present, `NODE_ENV` is not production, and `VERCEL` is absent. Connection routes additionally require the HTTP `127.0.0.1` origin, an authenticated owner, and a personal non-demo workspace. Shared-workspace execution is rejected.

## Verification

Local independent-worker acceptance on 15 October 2026 passed using the real ChatGPT provider in `machinarc_local`. `LOCAL-WORKER-CHECK` run `9bb46b4c-fb43-43ee-857c-3b248bf99cf8` completed after its browser tab was closed (1,388 tokens). Run `91badfe4-e364-45c8-855a-6cfae0177764` resumed after the worker was forcibly stopped following a persisted calculator result; it completed on the second queue attempt with exactly one calculator execution. Recovery waited for the original three-minute runtime lease to expire. The local database default was aligned to UTC before this check; production configuration was unchanged.

Run `npm.cmd run test:chatgpt-local` for mocked OAuth/JWKS, callback security, isolated credential storage, rotation, revocation, request conversion, and stream completion tests. These fixtures do not sign in to a real OpenAI account or prove real inference acceptance.

Implementation checks on 14 October 2026: all 31 database-independent unit tests passed, including 12 ChatGPT tests. The 12 ChatGPT tests passed again after adding the regression for streamed output items with an empty terminal output snapshot. TypeScript, focused ESLint, launcher syntax, and tracked source diff checks passed. The launcher correctly refused to start without its separate database configuration.

Real local acceptance: the user completed OpenAI sign-in and consent, and the account catalog supplied `gpt-6.1-sol`. `LOCAL-CALCULATOR` run `27c6259d-b895-4adf-a7e8-053d1ee20377` calculated `(12 * 4.5 + 3) / 2 = 28.5`, paused for a memory-write approval, resumed after Approve once, saved the memory, and completed with three AI turns, two tool calls, and 2,530 recorded tokens. Cost remains unpriced. The earlier failed runs are retained; their empty-output stream handling was corrected and covered by a regression test.

Real disconnect acceptance also passed: OpenAI acknowledged revocation, Settings showed Not connected, and run `7ed9157b-c1a4-44af-9aac-2bddae04af4c` failed with provider authentication required before any AI turn or tool call (zero tokens). No Mock Runtime fallback occurred.

The user reauthorized the saved account registration, and Settings returned to Connected with the same issued client registration. Retrying the blocked task completed as run `f95d4a5c-0b23-4a8a-8e94-0ab78f1c62bc`: `251350 * 1230923 = 309392496050`, two AI turns, one calculator call, and 1,441 recorded tokens. The account remains connected and the local Machine is idle and ready for use.

## Official contract

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts, refresh and revocation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Model catalog and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
