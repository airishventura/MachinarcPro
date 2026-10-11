import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

const STATUS: Record<string, { c: string; t: string; live?: boolean }> = {
  running: { c: "text-proc bg-proc", t: "RUNNING", live: true },
  online: { c: "text-ok bg-ok", t: "ONLINE", live: true },
  complete: { c: "text-ok bg-ok", t: "COMPLETE" },
  completed: { c: "text-ok bg-ok", t: "COMPLETED" },
  initializing: { c: "text-proc bg-proc", t: "INITIALIZING", live: true },
  approved: { c: "text-ok bg-ok", t: "APPROVED" },
  available: { c: "text-ok bg-ok", t: "AVAILABLE", live: true },
  idle: { c: "text-mute bg-mute", t: "IDLE" },
  draft: { c: "text-mute bg-mute", t: "DRAFT" },
  offline: { c: "text-dim bg-dim", t: "OFFLINE" },
  paused: { c: "text-warn bg-warn", t: "PAUSED" },
  pending: { c: "text-warn bg-warn", t: "PENDING" },
  busy: { c: "text-warn bg-warn", t: "BUSY" },
  queued: { c: "text-proc bg-proc", t: "QUEUED" },
  demo: { c: "text-mute bg-mute", t: "DEMO" },
  processing: { c: "text-proc bg-proc", t: "PROCESSING", live: true },
  failed: { c: "text-bad bg-bad", t: "FAILED" },
  denied: { c: "text-bad bg-bad", t: "DENIED" },
};

export function Status({ s, className = "" }: { s: string; className?: string }) {
  const st = STATUS[s.toLowerCase()] ?? STATUS.idle;
  const [text, bg] = st.c.split(" ");
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-[11px] tracking-[.12em] transition-colors duration-[180ms] ${text} ${className}`}>
      <span key={st.t} aria-hidden className={`status-land h-1.5 w-1.5 shrink-0 ${bg} ${st.live ? "dot-live rounded-full" : ""} ${s === "failed" ? "rotate-45" : ""}`} />
      {st.t}
    </span>
  );
}

/** Deterministic geometric identity glyph per Machine code. */
export function Glyph({ code, size = 36, active = false }: { code: string; size?: number; active?: boolean }) {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const cells = Array.from({ length: 9 }, (_, i) => (h >> i) & 1);
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" className="shrink-0" aria-hidden>
      <rect x=".5" y=".5" width="35" height="35" fill="#0d0e0e" stroke={active ? "#d9c9a8" : "#2a2c2b"} />
      {cells.map((c, i) => c ? <rect key={i} x={7 + (i % 3) * 8} y={7 + Math.floor(i / 3) * 8} width="6" height="6" fill={i === 4 && active ? "#d9c9a8" : "#f0eee9"} opacity={0.35 + ((h >> (i + 9)) & 3) * 0.2} /> : null)}
    </svg>
  );
}

export function PageHeader({ title, sub, children, eyebrow }: { title: string; sub?: string; children?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="t-title">{title}</h1>
        {sub && <p className="t-secondary mt-1.5">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "warn" | "bad" }) {
  const c = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-mute";
  return (
    <div className="bg-bg3 p-4">
      <div className="label">{label}</div>
      <div className="mt-2 font-mono text-2xl tabular-nums">{value}</div>
      {hint && <div className={`mt-1 font-mono text-[11px] ${c}`}>{hint}</div>}
    </div>
  );
}

export function Empty({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (
    <div className="grid-bg flex flex-col items-center border border-dashed border-line px-6 py-14 text-center">
      <div className="font-mono text-xs tracking-[.2em] text-fg">{title}</div>
      <p className="mt-2 max-w-sm text-sm text-mute">{body}</p>
      {href && cta && <Link href={href} className="btn btn-primary mt-6">{cta}</Link>}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="label !text-fg">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Logo({ pro = true }: { pro?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark />
      <span className="font-mono text-[13px] tracking-[.24em]">MACHINARC{pro && <span className="text-mute"> PRO</span>}</span>
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}
