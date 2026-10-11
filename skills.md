# MachinArc Pro — Design Skills

Distilled from the reference material (Science of Color, Psychology Behind Great UX, Information Architecture, Effective Onboarding) and applied to machinarcpro.com.

## 1. Color (Science of Color in UI)
- **60-30-10 rule**: 60% near-black surfaces (#090909/#0D0E0E/#121313), 30% panels & borders (#151616/#191A1A/#2A2C2B), 10% accent (restrained amber #D6A35C + off-white #F0EEE9).
- **Color psychology mapped to state only**: green = operational/health, amber = warning/paused/attention, red = critical/failed, blue = processing/trust. Never decorative.
- **Contrast & accessibility**: body text #F0EEE9 on #090909 (>15:1); secondary #8E918F (>6:1) — passes WCAG 4.5:1.
- **Dark mode best practices**: soft neutrals, not pure black; accent used thoughtfully; less color, more impact.
- **CTA color**: the single primary action per view uses the off-white solid button; secondary actions are outlined.

## 2. UX Psychology
- **Hick's Law**: limit choices — builder is split into 9 steps, filters are ≤6 options, onboarding offers 4 templates.
- **Fitts's Law**: primary CTAs are large, top-right on desktop; mobile has a bottom navigation bar inside thumb reach.
- **Visual hierarchy**: page title → status → KPIs → tables. Mono for values, grotesk for prose.
- **Cognitive load**: monochrome UI, color reserved for status, progressive disclosure via tabs.
- **Social proof**: landing shows live network stats and public Machine reputation.
- **Recognition over recall**: Machine IDs, status chips and avatars visible everywhere; templates instead of blank forms.
- **Peak-End rule**: deployment animation ("MACHINE ONLINE") is the peak; task completion confirmation is the end.
- **Motivation**: meaning (objective), progress (step indicator), rewards (credits/reputation), ease (templates).

## 3. Information Architecture
- Shallow sitemap: every page within 2 clicks of the sidebar.
- Sidebar groups: core (Overview, Machines, Arcs, Network, Activity), BUILD, SYSTEM.
- Consistent labels and terminology: Machine, Arc, Task, Run, Tool, Memory, Network, Credits, Operator.
- Findability: search + category filters on Machines and Network; breadcrumbs-like back links in detail pages.

## 4. Onboarding
- Welcome → Orient → Guide → Value → Retain mapped to 3 screens: Welcome, Choose template, Deploy.
- Progress indicator on onboarding and builder.
- Empty states are opportunities: product-specific copy + a single CTA ("NO MACHINES ONLINE").
- First success moment: deployment animation then redirect to the live Machine.
- Skippable.

## 5. Motion
- Motion communicates state only: pulse = online, sweep = running, static amber = paused, red = failed, packet along edge = communication.
- `prefers-reduced-motion` disables all animations.

---

## 6. Motion System (10 Principles of Motion Design → MachinArc)
Source: `src/app/motion.css`. Motion is communication, never decoration.

| Token | Value | Used for |
|---|---|---|
| `--dur-instant` | 120ms | button press, hover |
| `--dur-micro` | 180ms | toggles, focus rings, status dot, tab underline |
| `--dur-screen` | 320ms | page transition, dialogs, drawer, card entrances |
| `--dur-attention` | 600ms | authorization attention pulse (3 cycles, then still) |
| `--ease-out` | cubic-bezier(.16,1,.3,1) | anything entering |
| `--ease-standard` | cubic-bezier(.4,0,.2,1) | in-place state change |
| `--ease-emph` | cubic-bezier(.34,1.4,.64,1) | confirmations only (overshoot) |

| # | Principle | Applied as |
|---|---|---|
| 1 | Timing, spacing & rhythm | 4 duration tiers; 40ms stagger rhythm on lists/KPIs |
| 2 | Eases | No linear UI movement; out for enter, standard for change, emphasized for success |
| 3 | Mass & weight | Toggle thumb settles with slight overshoot; status dot "lands" on change |
| 4 | Anticipation | Buttons compress (scale .97, 60ms) before the action fires |
| 5 | Arcs | Entrances rise on Y with a micro-scale, not a flat slide |
| 6 | Squash & stretch | Press compression; status dot scale 0.4 → 1.35 → 1 |
| 7 | Follow-through & overlap | Staggered grids; hero headline → copy → CTAs overlap by 80ms |
| 8 | Exaggeration | Reserved: `success-pop` on TASK COMPLETE / MACHINE ONLINE, 3px `nudge` on errors |
| 9 | Secondary / layered | Ambient live-dot pulse and edge data-pulses only on RUNNING states |
| 10 | Appeal | Single consistent token set; motion stops when the state settles |

**Respect user preferences:** `prefers-reduced-motion` collapses all durations to ~0 (end states still apply, events still fire) and removes ambient loops (live dots, sweeps, skeleton shimmer, edge pulses, caret).

**Common mistakes avoided:** no motion without purpose (static panels don't animate), no infinite loops on idle states, no layout-shifting animations (transform/opacity only), no long durations (>320ms) on interactions.

---

## 7. UI/UX Design Checklist — Audit Results

| # | Item | Status | Evidence / Fix applied |
|---|---|---|---|
| 01 | Understand users | ✅ | Operator persona drives copy: approval cards, budget/limit language, "what is the Machine doing?" telemetry |
| 02 | Define the problem | ✅ | Every dashboard element answers what / why / act? / next (spec principle); empty states state the job |
| 03 | Plan the experience | ✅ | Flow: Landing → Sign up/Demo → Onboarding → Builder → Machine console → Run Inspector → Arcs |
| 04 | Wireframe / structure | ✅ | Shared primitives (PageHeader, Section, Kpi, Status, Empty); consistent header → status → metrics → detail |
| 05 | Visual hierarchy | ✅ fixed | Muted text `#626563` measured 3.4:1 → raised to `#7a7d7b` (4.6:1, WCAG AA). Single primary CTA per view |
| 06 | Design for mobile | ✅ fixed | Bottom nav targets raised to 48px (`min-h-12`), `.btn` min-height 40px, drawer slides with backdrop; tables collapse to lists; Arc builder shows larger-screen notice |
| 07 | Accessible | ✅ fixed | Added "Skip to content" link + focusable `<main id="main">`; `aria-current` on bottom nav; status never color-only (text label + dot shape); dialogs/alertdialogs labeled; reduced-motion honored |
| 08 | Keep it simple | ✅ | Monochrome UI, color only for state; progressive disclosure via tabs, `<details>` in Run Inspector |
| 09 | Design with empathy | ✅ | Errors explain cause + recovery ("Update Credentials", "Retry", "Edit Permissions"); nothing external happens before approval and the UI says so |
| 10 | Test, iterate, improve | ✅ | 35 automated tests (security, runtime, approvals, limits, Arcs); production build + typecheck gate each phase |

**Open items (next iteration):** real-user usability sessions; visual regression snapshots; Lighthouse/axe automated runs in CI.

---

## 8. Landing Motion Components (Framer-marketplace patterns, native implementation)
`src/components/landing/motion.tsx` — no animation library; rAF-throttled passive scroll, IntersectionObserver, `useSyncExternalStore` for reduced motion.

| Component | Framer pattern | MachinArc use |
|---|---|---|
| `ScrollProgress` | Scroll progress bar | 1px amber rail at top of landing |
| `ScrollTextReveal` | Scroll text reveal | Manifesto: words light up as you scroll; key terms turn amber |
| `ScrambleText` | Text scramble / decode | Section titles "boot" like a machine when they enter view |
| `CountUp` | Number ticker | Network stats count up, then tick live |
| `Marquee` | Ticker | Live network event stream (pauses on hover) |
| `StickySteps` | Sticky scroll sections | FROM INTENT TO AUTONOMY — progress rail + crossfading config panels |
| `TypeTerminal` | Typewriter | Machine terminal types a real-looking run incl. authorization |
| `Spotlight` | Cursor glow card | Network + capability cards follow the pointer |
| `Parallax` | Scroll parallax | Hero network field drifts slower than content |
| `Reveal` | Appear on scroll | Staggered entrances (60–80ms rhythm) |
All collapse to static end states under `prefers-reduced-motion`.

---

## 9. Canonical Architecture (Phase 3.5) & Autonomous Runtime (Phase 4)

**This repository is the sole canonical implementation.** No "Build (2)" exists on disk; nothing was ported.

**Removed during consolidation:** legacy `approvals`, `integrations`, `api_keys` tables · `machine_runs.stage` · `runTask()` back-compat wrapper · duplicate `levelColor`, `PROVIDERS`, `MACHINE_TYPES`, `TOOLS`, legacy `TEMPLATES` + `template-grid` · duplicate `setPermission` action · legacy dashboard `ApprovalCard` · all in-request `after()` and `setTimeout` execution.

**Single paths now:** approvals → `approval_requests` (`kind: tool | network_hire`) · demo data → `src/lib/seed/demo.ts` · background work → `jobs` queue · templates → `STARTERS` (Machines) + `ARC_TEMPLATES` (Arcs) · reduced-motion → one hook.

**Schema & migrations:** `drizzle/0000_canonical_schema.sql` (generated, versioned). Apply with `npx drizzle-kit migrate`. RLS for Supabase: `psql "$DATABASE_URL" -f supabase/rls.sql` (idempotent; verified in tests inside a rolled-back transaction).

**Durable execution model**
```
action / schedule / webhook / event ──► jobs (Postgres) ──► worker(s) ──► MachineRuntime / ArcRuntime
                                           ▲  FOR UPDATE SKIP LOCKED, 5-min leases renewed every 60s,
                                           │  exponential backoff → dead-letter, dedupe keys
                         orphan sweep ─────┘  (runs with expired locks + no active job are re-enqueued)
```
- Workers: in-process via `src/instrumentation.ts` (disable with `MARC_WORKER=off`) and/or dedicated `npx tsx --conditions=react-server scripts/worker.ts`. Any number can run concurrently.
- Runs resume from persisted state (messages, tool executions), so a crashed worker's job is safely re-claimed.
- Schedules: interval (≥60s; "Continuous" = every minute with skip-overlap) or 5-field UTC cron. Missed windows are not replayed.
- Webhooks: `POST /api/hooks/whk_<prefix>_<secret>` — SHA-256 hashed tokens, shown once, 64KB limit, rate limited, body secrets redacted, always async (202).
- Event triggers: Machine/Arc completed | failed | any → start another target with `{{output}} {{status}} {{source}}`; chains capped at 5 hops; self-trigger rejected.
- Every automated start is audited in `trigger_fires`.

**Operations:** `scripts/seed-demo.ts` (canonical demo) · `tests/phase3.test.ts` (35) · `tests/phase4.test.ts` (13, incl. RLS) — run with `npx tsx --conditions=react-server --test tests/*.test.ts`.
