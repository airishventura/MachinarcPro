# MachinArc pilot

Status: preparation only. Target: three to five consenting operators. No participants have been recruited and no user results are claimed. Public experience: isolated Mock Runtime demo; real AI: invite-only, supervised local pilot. Contact: hello@machinarcpro.com.

## Entry gates

- Local real-provider acceptance passed: ChatGPT calculation, memory approval/resume, disconnect and reconnect, independent-worker restart and persisted-result reuse. See `CHATGPT_LOCAL.md`. Local plan usage is unpriced; do not present $0 estimates as free inference.
- Local denial/cancellation restart acceptance passed on 16 October 2026. Denied memory writes produced no memory; cancellation stopped before tool execution; neither resumed after restart. Queue leases cleared naturally. Evidence remains in ignored `.validation/local-boundary-result.json`; these are operator acceptance checks, not participant outcomes.
- Hosted API-key acceptance remains deferred: short task, calculator, approval/resume, provider identity, output, usage, known cost or explicit unpriced state, and no mock fallback. Do not offer hosted real-AI pilot access before it passes.
- Disposable-database integration suite, including the RLS probe, passes.
- Desktop and phone checks cover onboarding, Machine creation, approval, run inspection and error recovery.
- Hosted calculator and external-write interruption acceptance passed on 14 October 2026: actual SIGKILL in disposable Vercel Sandboxes, followed by recovery through the protected staging scheduler after natural lease expiry. Completed results were reused; unknown outcomes stopped without replay. A temporary HTTPS receiver counted exactly one real POST per external-write case; neither write was repeated.

## Sessions

### Recruitment and consent

Use `hello@machinarcpro.com` for invitations and support. Before inviting anyone, the owner must confirm the mailbox receives mail and that someone will monitor it. No response-time promise is made. Prepare outreach for owner review; do not contact people without authorization.

Suggested invitation: "MachinArc is inviting three to five operators to a supervised beta session for a repeatable research or operations task. The public demo is simulated; this session evaluates real AI locally. Participation is optional. Reply with a non-sensitive workflow if interested. No purchase or token holding is required."

Before a session, obtain participation consent and separate optional consent for recordings or public quotations. Explain provider limits, local execution, what observations will be retained, and how to request deletion through the support address. Use participant codes in repository notes. Keep identities, consent records, task inputs and recordings outside the public repository. Never ask a participant to share credentials or use the operator's connected account unsupervised.

Recruit three to five operators who have a real repeatable research or operations task. Begin with research and calculator tools; introduce external writes only to a harmless test destination.

Ask each participant to create a Machine, run their task, inspect its sources and provider usage, handle an approval, and explain the result. Observe without coaching the first attempt. Record actual time, failures, confusing labels, approval understanding and whether the output solves the intended task. Network hiring is a labeled catalog simulation and must not be described as marketplace execution.

### Session record (blank template; not an outcome)

| Field | Record |
| --- | --- |
| Participant code / session date | Pending |
| Consent recorded privately / recording or quote permission | Pending |
| Workflow, input boundaries and success criteria | Pending |
| Environment and actual provider / model | Pending |
| Created Machine / run reference | Pending |
| Onboarding and task completed without coaching | Pending |
| Understood approval and demo limitations | Pending |
| Output/source review / useful result | Pending |
| Time, errors, recovery and support effort | Pending |
| Provider usage / estimate or unpriced state | Pending |
| Blocker, owner and resolution evidence | Pending |

## Release checklist

- [x] Local operator smoke check (16 October 2026): create a Mock Runtime Machine, complete a task, inspect its saved run on desktop and at 390px phone width, confirm no credential forms and zero stored credentials, and reject a private-workspace Machine with 404. Run `a6aee123-99ff-45ad-9b9f-c2b6b4b37446`; evidence in ignored `.validation/launch-demo-result.json` and `launch-demo-*.jpg`. This is not a participant session or production acceptance.
- [x] Protected staging acceptance (16 October 2026): the public status page was reviewed, and a fresh isolated visitor workspace created a Machine and completed and inspected a mock run at desktop and 390px phone widths. Mock execution and simulated sources were labeled; demo integrations were read-only with no credential inputs, and the workspace stored zero integration credentials. The authenticated worker endpoint rejected an unauthenticated request. Evidence: staging run `d03ba034-a0e2-44b5-8ec4-ef284c82057b` in the review record for PR #8. This is hosted mock acceptance, not hosted real-AI or participant acceptance.
- [ ] Owner confirms `hello@machinarcpro.com` receives mail and is monitored; support contact link and published guidance are checked. Mailbox delivery has not been tested.
- [ ] At least three consenting operators complete their intended task and understand approvals and limitations.
- [ ] No unresolved data exposure, lost work or duplicated external action. Record and resolve failures before continuing.
- [ ] Owner reviews actual outcomes and explicitly approves readiness. No invented customer, uptime, revenue or pilot metrics.

The pilot is not token-gated. A community token grants no product access or other promised rights. See `docs/ORYNTH_LAUNCH.md` for the separate launch review and remaining owner inputs.

## Decision

Prioritize observed blockers before adding features. Do not open paid usage or describe marketplace transactions as real until execution, billing units and settlement are validated. Keep personal feedback private and obtain consent before sharing recordings or quotes.
