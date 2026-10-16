# Beta launch preparation release

Prepared 16 October 2026. Branch: `codex/orynth-launch-preparation`, based on merged main `294e4a9`. This release contains launch messaging, `/docs/status`, persistent demo notices, read-only demo integrations, and pilot/Orynth preparation documents. It excludes the separate local artwork, icon, branding and layout edits. No migrations or dependency changes are required.

## Live preflight

The production Vercel project is `machinarc` (`prj_LQ1HGbDch6OjwYjgiNAtBzNCCdXO`) on team `team_rZgbsCD4lHIpfo1ieWAAksXw`. A read-only Vercel check found the READY production deployment `dpl_AGMkf3GvrcBX9EfKCDtkPu1FyLcT`, `https://machinarc-lqc5j1n0x-julienseven.vercel.app`, carrying source metadata `3295ea3ed53609ea1cdd888a8f9dae88315fea99`. Its aliases include `machinarcpro.com` and `www.machinarcpro.com`.

The browser reached `https://machinarcpro.com/docs/status` and displayed Page not found / ERR 404. Launch preparation is therefore not deployed. Stop the launch-readiness claim at this failed gate; the existing deployment's READY state is not acceptance of these new changes.

## Review and rollout

1. Review this focused PR and require the Checks workflow: TypeScript, lint, unit tests, disposable PostgreSQL integration tests and production build.
2. Verify the exact release revision on a protected staging preview. Use only the staging project's database and secrets; do not attach a preview to production data. Recheck homepage/status, desktop and phone demo entry, creation, run inspection and blocked credential controls. Local evidence in `PILOT.md` does not replace hosted acceptance.
3. After explicit production approval, deploy an isolated checkout of the reviewed revision to the production project with its own production environment. Never promote the separate staging project's deployment or copy staging secrets into production.
4. Verify `/docs/status`, demo disclosures, support mail links, and an isolated production visitor's mock task flow. Confirm the trusted production scheduler still executes tasks. Preserve registered-workspace integrations and cross-workspace isolation.
5. If the release fails acceptance, restore the verified pre-release deployment above and recheck its aliases. Record the failed gate without claiming readiness.

Participant sessions, mailbox receipt/monitoring, hosted real-provider acceptance and final token owner/legal inputs remain pending. This release authorizes no token deployment, purchase, wallet signature or launch announcement. See `ORYNTH_LAUNCH.md`.
