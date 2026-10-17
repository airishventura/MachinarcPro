import Link from "next/link";
import Image from "next/image";
import { ArcDemo } from "@/components/landing-viz";
import { MotionArtwork } from "@/components/motion-artwork";
import { Icon } from "@/components/icon";
import { Reveal, ScrambleText, ScrollProgress, ScrollTextReveal, StickySteps, TypeTerminal } from "@/components/landing/motion";
import { CapabilityGrid, EventTicker, LandingStats, NetworkCards } from "@/components/landing/sections";
import { Logo } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { enterDemoAction } from "@/app/actions";

const STEPS = [
  { n: "01", t: "CREATE", d: "Define what your Machine exists to do.", detail: "name       RESEARCH-SCOUT\nid         MARC-SCT-8821\nobjective  Research a topic using real web sources\n           and produce an evidence-backed briefing." },
  { n: "02", t: "EQUIP", d: "Give it models, tools, memory, data, and permissions.", detail: "model      gpt-5 · reasoning medium\ntools      web_search  fetch_page  remember\nmemory     persistent · 5 relevant per run\nnetwork_write  ASK   ·   code_execution  DENY" },
  { n: "03", t: "DEPLOY", d: "Run continuously or trigger it when conditions occur.", detail: "schedule   every 60 min · skip overlap\nwebhook    POST /api/hooks/whk_••••\nevent      on SCOUT completed → INTELLIGENCE ARC\nworker     2 live · lease 5m · crash-safe" },
  { n: "04", t: "EVOLVE", d: "Track performance and improve its behavior.", detail: "runs       1,284 · success 97.8%\nsources    12,906 accessed · 0 fabricated\nspend      $38.22 / $150 monthly\nmemories   214 · 31 pinned" },
];
const TERMINAL = [
  { t: "00:00.0", lvl: "SYSTEM", msg: "Run started · OpenAI / gpt-5", c: "text-mute" },
  { t: "00:00.4", lvl: "MEMORY", msg: "Loaded 3 relevant memories", c: "text-ok" },
  { t: "00:01.2", lvl: "AI", msg: "Constructing execution plan", c: "text-amber" },
  { t: "00:02.1", lvl: "TOOL REQUEST", msg: 'WEB SEARCH · "robotics foundation models 2026"', c: "text-proc" },
  { t: "00:02.1", lvl: "PERMISSION", msg: "network_read → ALLOW", c: "text-mute" },
  { t: "00:04.6", lvl: "TOOL RESULT", msg: "10 results · 10 sources recorded [S1–S10]", c: "text-ok" },
  { t: "00:05.4", lvl: "TOOL REQUEST", msg: "FETCH PAGE · techcrunch.com", c: "text-proc" },
  { t: "00:07.9", lvl: "TOOL RESULT", msg: "18,204 characters extracted", c: "text-ok" },
  { t: "00:09.2", lvl: "APPROVAL", msg: "AUTHORIZATION REQUIRED · HTTP POST → crm.acme.io", c: "text-warn" },
  { t: "00:41.7", lvl: "APPROVAL", msg: "APPROVED by operator · APPROVE ONCE", c: "text-warn" },
  { t: "00:44.0", lvl: "OUTPUT", msg: "Task completed · 44.0s · $0.0312 · 6 sources cited", c: "text-ok" },
];

export default async function Landing() {
  const s = await getSession();
  const enter = s ? "/app" : "/register";
  return (
    <main className="bg-bg">
      <ScrollProgress />
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <Logo pro={false} />
          <nav className="flex items-center gap-2" aria-label="Primary">
            <Link href="#process" className="hidden items-center gap-2 px-3 font-mono text-xs tracking-widest text-mute hover:text-fg md:inline-flex"><Icon name="workflow" size={14} className="hidden lg:block" />PROCESS</Link>
            <Link href="#arcs" className="hidden items-center gap-2 px-3 font-mono text-xs tracking-widest text-mute hover:text-fg md:inline-flex"><Icon name="workflow" size={14} className="hidden lg:block" />ARCS</Link>
            <Link href="#network" className="hidden items-center gap-2 px-3 font-mono text-xs tracking-widest text-mute hover:text-fg lg:inline-flex"><Icon name="network" size={14} className="hidden lg:block" />NETWORK</Link>
            <Link href="/docs" className="hidden items-center gap-2 px-3 font-mono text-xs tracking-widest text-mute hover:text-fg sm:inline-flex"><Icon name="book" size={14} className="hidden lg:block" />DOCS</Link>
            <span className="hidden sm:block"><Link href="/docs/status" className="btn h-11"><Icon name="shield" size={14} className="hidden lg:block" />Beta status</Link></span>
            {s ? <Link href="/app" aria-label="Command Center" className="btn btn-primary h-11"><Icon name="overview" size={15} className="hidden lg:block" /><span className="sm:hidden">Workspace</span><span className="hidden sm:inline">Command Center</span></Link> : <><form action={enterDemoAction}><button className="btn btn-primary h-11"><Icon name="play" size={14} className="hidden lg:block" />Try Demo</button></form><span className="hidden sm:block"><Link href="/login" className="btn h-11">Sign in</Link></span></>}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-line">
        <MotionArtwork src="/images/editorial/hero-scene.webp" priority />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/60 to-bg/15" />
        <div className="relative mx-auto max-w-7xl px-5 py-24 md:py-36">
          <div className="label fade-up flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-amber" /><ScrambleText text="MACHINARC · BETA" /></div>
          <h1 className="fade-up mt-6 max-w-4xl text-[44px] font-medium leading-[0.95] tracking-tight [animation-delay:60ms] sm:text-6xl md:text-[88px]">BUILD MACHINES<br />THAT LIVE ON<br /><span className="text-mute">THE INTERNET.</span></h1>
          <p className="fade-up mt-8 max-w-md text-lg text-mute [animation-delay:140ms]">Give them an objective, tools, memory, and clear permissions.<br /><span className="text-fg">Inspect the work at every step.</span></p>
          <div className="fade-up mt-10 flex flex-wrap gap-3 [animation-delay:220ms]">
            {s ? <Link href="/app/machines/new" className="btn btn-primary h-12 px-6"><Icon name="plus" size={16} />Create Machine</Link> : <form action={enterDemoAction}><button className="btn btn-primary h-12 px-6"><Icon name="play" size={16} />Try Demo</button></form>}
            <a href="mailto:hello@machinarcpro.com?subject=MachinArc%20pilot%20request" className="btn h-12 px-6">Request pilot invitation</a>
          </div>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-mute">Public demo: Mock Runtime, simulated tools and example history. No sign-up needed. Real AI is evaluated separately in an invite-only pilot. <Link href="/docs/status" className="text-amber underline underline-offset-4">Capabilities &amp; limits</Link></p>
          {!s && <Link href="/register" className="mt-2 inline-flex min-h-11 items-center text-sm text-mute underline underline-offset-4">Create an account</Link>}
          <div className="mt-16 font-mono text-xs tracking-[.3em] text-dim">CREATE · DEPLOY · OBSERVE · EVOLVE</div>
        </div>
      </section>

      <EventTicker />
      <LandingStats />

      <section className="mx-auto max-w-5xl px-5" aria-label="Manifesto">
        <ScrollTextReveal className="text-3xl font-medium leading-[1.15] tracking-tight md:text-6xl" accent={["MACHINES", "OBJECTIVE", "PERMISSION", "ACCOUNTABLE."]}
          text="Software used to wait for instructions. Machines receive an objective, choose their tools, ask permission before acting, and remain accountable for every step." />
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20 md:pb-28" aria-labelledby="principles-heading">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="label">THE OPERATING PRINCIPLES</p>
              <h2 id="principles-heading" className="mt-3 max-w-2xl text-3xl font-medium tracking-tight md:text-5xl">Autonomy you can oversee.</h2>
            </div>
            <Link href="#process" className="inline-flex min-h-11 items-center gap-2 font-mono text-xs tracking-wider text-amber underline-offset-4 hover:underline">SEE HOW IT WORKS<Icon name="arrow" size={16} /></Link>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <Reveal>
            <figure className="h-full border border-line bg-bg2">
              <Image src="/images/editorial/human-control.webp" alt="Delegate the work. Keep the decision. A graphite gate pauses an amber route at a permission boundary." width={1122} height={1402} sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1152px) calc((100vw - 72px) / 2), 540px" className="h-auto w-full" />
              <figcaption className="border-t border-line p-5 md:p-6">
                <h3 className="flex items-center gap-2 font-mono text-xs tracking-wider text-amber"><Icon name="shield" size={16} />01 / PERMISSION BOUNDARIES</h3>
                <p className="mt-3 text-sm leading-relaxed text-mute">Choose which actions are allowed, require approval, or are off-limits. When approval is required, the Machine waits for your decision.</p>
              </figcaption>
            </figure>
          </Reveal>
          <Reveal delay={80}>
            <figure className="h-full border border-line bg-bg2">
              <Image src="/images/editorial/inspect-the-run.webp" alt="Done. Now show the work. A cutaway graphite machine reveals the connected stages of its amber route." width={1122} height={1402} sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1152px) calc((100vw - 72px) / 2), 540px" className="h-auto w-full" />
              <figcaption className="border-t border-line p-5 md:p-6">
                <h3 className="flex items-center gap-2 font-mono text-xs tracking-wider text-amber"><Icon name="activity" size={16} />02 / INSPECTABLE RUNS</h3>
                <p className="mt-3 text-sm leading-relaxed text-mute">Inspect tool requests, approval decisions, results, and errors in the recorded run. Follow what happened from the first request to the final output.</p>
              </figcaption>
            </figure>
          </Reveal>
        </div>
        <p className="mt-4 font-mono text-[10px] tracking-wider text-dim">CONCEPTUAL BRAND ILLUSTRATIONS</p>
      </section>

      <section id="process" className="border-t border-line"><p className="mx-auto max-w-7xl px-5 pt-6 text-sm text-mute">Illustrative configuration and metrics below; not platform activity or customer results.</p><StickySteps steps={STEPS} /></section>

      <section className="border-y border-line bg-bg2">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-24 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <Reveal><div className="label">TELEMETRY</div></Reveal>
            <Reveal delay={60}><h2 className="mt-3 text-3xl font-medium tracking-tight md:text-5xl"><ScrambleText text="WATCH IT WORK." /></h2></Reveal>
            <Reveal delay={120}><p className="mt-4 max-w-md text-mute">Every plan, tool call, permission decision and source is streamed live and kept for inspection. Operational telemetry — never hidden reasoning.</p></Reveal>
            <div className="mt-10"><CapabilityGrid /></div>
          </div>
          <Reveal delay={100}><TypeTerminal lines={TERMINAL} /><p className="mt-3 font-mono text-[10px] tracking-wider text-dim">ILLUSTRATIVE RUN · EXAMPLE OUTPUT AND COST</p></Reveal>
        </div>
      </section>

      <section id="arcs" className="border-b border-line">
        <div className="mx-auto max-w-7xl px-5 py-24">
          <div className="mb-12 grid items-center gap-8 lg:grid-cols-2">
            <div>
              <Reveal><div className="label">ARCS</div></Reveal>
              <Reveal delay={60}><h2 className="mt-3 text-3xl font-medium tracking-tight md:text-5xl">Machines that hand work to each other.</h2></Reveal>
            </div>
            <Reveal delay={80}>
              <figure>
                <Image src="/images/editorial/arc-handoff.webp" alt="Three graphite modules share an amber route, illustrating work passing from one Machine to the next." width={1600} height={800} sizes="(max-width: 1023px) calc(100vw - 40px), 600px" className="h-auto w-full" />
                <figcaption className="mt-2 font-mono text-[10px] tracking-wider text-dim">ONE WORKFLOW / CONNECTED MACHINES · CONCEPTUAL ILLUSTRATION</figcaption>
              </figure>
            </Reveal>
          </div>
          <Reveal delay={120}><ArcDemo /></Reveal>
        </div>
      </section>

      <section id="network" className="mx-auto max-w-7xl px-5 py-24">
        <Reveal><div className="label">NETWORK</div></Reveal>
        <Reveal delay={60}><h2 className="mt-3 text-3xl font-medium tracking-tight md:text-5xl"><ScrambleText text="THE MACHINE NETWORK" /></h2></Reveal>
        <Reveal delay={120}><p className="mt-3 max-w-lg text-mute">Explore a simulated Machine catalog. Machines, ratings, activity, and prices are examples. Hiring does not execute another Machine or move Credits.</p></Reveal>
        <NetworkCards />
      </section>

      <section id="enter" className="relative overflow-hidden border-t border-line">
        <MotionArtwork src="/images/editorial/closing-scene.webp" variant="closing" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/90 via-bg/65 to-bg/40" />
        <div className="relative mx-auto max-w-7xl px-5 py-28 text-center md:py-36">
          <Reveal><h2 className="mx-auto max-w-4xl text-3xl font-medium leading-tight tracking-tight md:text-5xl">THE INTERNET WAS BUILT FOR HUMANS.<br /><span className="text-mute">THE NEXT ONE WILL BE BUILT FOR MACHINES.</span></h2></Reveal>
          <Reveal delay={120}><div className="mt-10 flex flex-wrap justify-center gap-3">{s ? <Link href={enter} className="btn btn-primary h-12 px-8">Open workspace</Link> : <form action={enterDemoAction}><button className="btn btn-primary h-12 px-8"><Icon name="play" size={16} />Try Demo</button></form>}<Link href="/docs/status#pilot-and-support" className="btn h-12 px-8">Pilot &amp; support</Link></div></Reveal>
        </div>
      </section>
      <footer className="border-t border-line"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-5 py-8 font-mono text-[11px] tracking-widest text-mute"><span>© 2026 MACHINARC · BETA</span><nav aria-label="Resources" className="flex flex-wrap gap-6"><Link href="/docs" className="py-3 hover:text-amber">Docs</Link><Link href="/docs/status" className="py-3 hover:text-amber">Status &amp; limits</Link><Link href="/whitepaper" className="py-3 hover:text-amber">Whitepaper</Link><a href="mailto:hello@machinarcpro.com" className="py-3 hover:text-amber">Contact</a></nav><span>Create. Deploy. Observe. Evolve.</span></div></footer>
    </main>
  );
}
