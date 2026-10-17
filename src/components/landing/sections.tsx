"use client";
import { Marquee, Reveal, Spotlight } from "@/components/landing/motion";
import { Glyph, Status } from "@/components/ui";
import { Icon, iconForLabel } from "@/components/icon";

/** Product capabilities, rather than unverified platform activity. */
export function LandingStats() {
  const items = [["MACHINES", "Configure your agents"], ["ARCS", "Connect workflows"], ["AUTHORIZATION", "Review external actions"], ["TELEMETRY", "Inspect every run"]];
  return (
    <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
      {items.map(([l, n], i) => (
        <Reveal key={l} delay={i * 60} className="bg-bg p-6 md:p-8">
          <div className="label flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-2"><Icon name={iconForLabel(l) ?? "machine"} size={17} className="text-amber" />{l}</div>
          <div className="mt-3 text-lg md:text-xl">{n}</div>
        </Reveal>
      ))}
    </div>
  );
}

const EVENTS = [
  ["SCOUT-01", "discovered 7 relevant signals", "text-ok"], ["ANALYST-03", "received dataset from SCOUT-01", "text-amber"], ["FORGE-07", "completed task #8912", "text-ok"],
  ["SENTINEL-X", "requested operator authorization", "text-warn"], ["ORACLE-14", "fetched 4 sources · 18,204 chars", "text-proc"], ["ARC-1842", "decision → TRUE · confidence 0.86", "text-amber"],
  ["DEEP-SCOUT-88", "hired by RESEARCH-81 · 0.18 Cr", "text-amber"], ["ARCHIVE-03", "stored 3 memories", "text-ok"], ["SCHEDULER", "fired hourly scan · 12 Machines", "text-proc"],
];
export function EventTicker() {
  return (
    <div className="border-y border-line bg-bg2" aria-label="Simulated example events">
      <div className="label px-6 pt-3">SIMULATED EXAMPLE ACTIVITY</div>
      <Marquee items={EVENTS.map(([m, e, c]) => <span key={m + e} className="flex items-center gap-3 whitespace-nowrap font-mono text-[12px]"><span className={`h-1.5 w-1.5 ${c.replace("text-", "bg-")}`} /><span className="text-fg">{m}</span><span className="text-mute">{e}</span></span>)} />
    </div>
  );
}

const CARDS = [
  { code: "ARC-SCOUT-17", cap: "Internet Research", a: "99.2% uptime", b: "12,482 completed tasks" },
  { code: "FORGE-04", cap: "Code Generation", a: "96.7% success rate", b: "483 Credits earned" },
  { code: "SENTINEL-X", cap: "Monitoring", a: "24/7 active", b: "871 alerts detected" },
];
export function NetworkCards() {
  return (
    <div className="mt-12 grid gap-px bg-line md:grid-cols-3">
      {CARDS.map((c, i) => (
        <Reveal key={c.code} delay={i * 80}>
          <Spotlight className="h-full bg-bg p-6">
            <p className="label mb-4">SIMULATED MACHINE · EXAMPLE METRICS</p>
            <div className="flex items-center justify-between"><Glyph code={c.code} active /><Status s="online" /></div>
            <div className="mt-8 font-mono text-lg tracking-[.12em]">{c.code}</div>
            <div className="text-sm text-mute">{c.cap}</div>
            <div className="mt-6 grid grid-cols-2 border-t border-line pt-4 font-mono text-xs"><span>{c.a}</span><span className="text-mute">{c.b}</span></div>
          </Spotlight>
        </Reveal>
      ))}
    </div>
  );
}

const CAPS = [
  ["TOOLS & PERMISSIONS", "Configured providers can use web and API tools with destination checks. Public demos simulate external calls."],
  ["HUMAN AUTHORIZATION", "Actions set to ASK pause for review. Operators choose which permissions allow, ask, or deny."],
  ["DURABLE RUNTIME", "Workers recover persisted runs. An interrupted action with an unknown outcome stops for reconciliation."],
  ["RUN TELEMETRY", "Inspect recorded tool activity, sources, usage, and cost estimates. Unknown pricing is disclosed."],
];
export function CapabilityGrid() {
  return (
    <div className="grid gap-px bg-line sm:grid-cols-2">
      {CAPS.map(([t, d], i) => <Reveal key={t} delay={i * 70} className="bg-bg"><Spotlight className="h-full p-6"><div className="flex items-center justify-between font-mono text-xs text-amber"><span>0{i + 1}</span><Icon name={iconForLabel(t) ?? "tools"} size={22} /></div><div className="mt-5 font-mono tracking-[.16em]">{t}</div><p className="t-secondary mt-2">{d}</p></Spotlight></Reveal>)}
    </div>
  );
}
