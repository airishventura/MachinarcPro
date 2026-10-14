# Pending production release

Prepared 14 October 2026. Live promotion has not been performed by this release task.

- Review: https://github.com/airishventura/MachinarcPro/pull/1
- Branch: `codex/staging-acceptance` → `main`.
- Validated UI preview: https://machinarc-staging-ajs5xh7kh-julienseven.vercel.app/
- Full source checks: https://github.com/airishventura/MachinarcPro/actions/runs/38522255797
- Native reduced-motion visual verification was explicitly skipped by the operator.
- Real-provider acceptance remains deferred; participant pilot sessions have not occurred.

## Production preflight

The production Vercel project is `machinarc` (`prj_LQ1HGbDch6OjwYjgiNAtBzNCCdXO`), on team `team_rZgbsCD4lHIpfo1ieWAAksXw`.
Its primary domain is https://machinarcpro.com/. A read-only preflight returned HTTP 200 and confirmed the existing production database `postgres`, server role `machinarc_server`, all five required runtime/approval/queue/rate-limit tables, and zero public application tables without RLS.

The current production rollback point is `dpl_7eH1HKmh6mMDztcDTtb5hpDgDqvz`, https://machinarc-g2gnamvue-julienseven.vercel.app/. Its production aliases include `machinarcpro.com`, `www.machinarcpro.com` and `machinarc.vercel.app`. The live homepage does not yet include the new hero grid.

## Release procedure after approval

1. Merge the reviewed PR, preserving unrelated working-tree changes.
2. Build/deploy an isolated checkout of the merged commit linked to the **production** Vercel project. Use that project's production environment. Do not promote the staging project's deployment or copy its `machinarc_staging` database URL, encryption key, worker secret or protection token.
3. Check production deployment readiness, aliases, homepage, registration/sign-in routing, and an authenticated Mock Runtime approval/resume flow using a disposable production acceptance account. Keep real-provider execution deferred.
4. If validation fails, restore the recorded production deployment and report the failed gate.

The separate, uncommitted branding changes visible in the review preview are excluded from this PR. Resolve that scope explicitly before including them in a production release.
