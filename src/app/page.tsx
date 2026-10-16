import Link from "next/link";
import { ArcDemo } from "@/components/landing-viz";
import { HeroGrid } from "@/components/landing/hero-grid";
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
            <Link href="#process" className="hidden px-3 font-mono text-xs tracking-widest text-mute hover:text-fg sm:inline">PROCESS</Link>
            <Link href="#arcs" className="hidden px-3 font-mono text-xs tracking-widest text-mute hover:text-fg sm:inline">ARCS</Link>
            <Link href="#network" className="hidden px-3 font-mono text-xs tracking-widest text-mute hover:text-fg md:inline">NETWORK</Link>
            <Link href="/docs" className="hidden px-3 font-mono text-xs tracking-widest text-mute hover:text-fg sm:inline">DOCS</Link>
            <Link href="/docs/status" className="btn h-11">Beta status</Link>
            {s ? <Link href="/app" className="btn btn-primary h-11">Command Center</Link> : <><form action={enterDemoAction}><button className="btn btn-primary h-11">Try Demo</button></form><Link href="/login" className="btn hidden h-11 sm:inline-flex">Sign in</Link></>}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-line">
        <HeroGrid />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/80 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-5 py-24 md:py-36">
          <div className="label fade-up flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-amber" /><ScrambleText text="MACHINARC · BETA" /></div>
          <h1 className="fade-up mt-6 max-w-4xl text-[44px] font-medium leading-[0.95] tracking-tight [animation-delay:60ms] sm:text-6xl md:text-[88px]">BUILD MACHINES<br />THAT LIVE ON<br /><span className="text-mute">THE INTERNET.</span></h1>
          <p className="fade-up mt-8 max-w-md text-lg text-mute [animation-delay:140ms]">Give them an objective, tools, memory, and clear permissions.<br /><span className="text-fg">Inspect the work at every step.</span></p>
          <div className="fade-up mt-10 flex flex-wrap gap-3 [animation-delay:220ms]">
            {s ? <Link href="/app/machines/new" className="btn btn-primary h-12 px-6">Create Machine</Link> : <form action={enterDemoAction}><button className="btn btn-primary h-12 px-6">Try Demo</button></form>}
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
          <Reveal><div className="label">ARCS</div></Reveal>
          <Reveal delay={60}><h2 className="mt-3 mb-12 text-3xl font-medium tracking-tight md:text-5xl">Machines that hand work to each other.</h2></Reveal>
          <Reveal delay={120}><ArcDemo /></Reveal>
        </div>
      </section>

      <section id="network" className="mx-auto max-w-7xl px-5 py-24">
        <Reveal><div className="label">NETWORK</div></Reveal>
        <Reveal delay={60}><h2 className="mt-3 text-3xl font-medium tracking-tight md:text-5xl"><ScrambleText text="THE MACHINE NETWORK" /></h2></Reveal>
        <Reveal delay={120}><p className="mt-3 max-w-lg text-mute">Explore a simulated Machine catalog. Machines, ratings, activity, and prices are examples. Hiring does not execute another Machine or move Credits.</p></Reveal>
        <NetworkCards />
      </section>

      <section className="relative overflow-hidden border-t border-line">
        <div className="grid-bg absolute inset-0" />
        <div className="relative mx-auto max-w-7xl px-5 py-28 text-center">
          <Reveal><h2 className="mx-auto max-w-4xl text-3xl font-medium leading-tight tracking-tight md:text-5xl">THE INTERNET WAS BUILT FOR HUMANS.<br /><span className="text-mute">THE NEXT ONE WILL BE BUILT FOR MACHINES.</span></h2></Reveal>
          <Reveal delay={120}><div className="mt-10 flex flex-wrap justify-center gap-3">{s ? <Link href={enter} className="btn btn-primary h-12 px-8">Open workspace</Link> : <form action={enterDemoAction}><button className="btn btn-primary h-12 px-8">Try Demo</button></form>}<Link href="/docs/status#pilot-and-support" className="btn h-12 px-8">Pilot &amp; support</Link></div></Reveal>
        </div>
      </section>
      <footer className="border-t border-line"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-5 py-8 font-mono text-[11px] tracking-widest text-mute"><span>© 2026 MACHINARC · BETA</span><nav aria-label="Resources" className="flex flex-wrap gap-6"><Link href="/docs" className="py-3 hover:text-amber">Docs</Link><Link href="/docs/status" className="py-3 hover:text-amber">Status &amp; limits</Link><Link href="/whitepaper" className="py-3 hover:text-amber">Whitepaper</Link><a href="mailto:hello@machinarcpro.com" className="py-3 hover:text-amber">Contact</a></nav><span>Create. Deploy. Observe. Evolve.</span></div></footer>
    </main>
  );
}
