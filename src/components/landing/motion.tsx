"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

// ---------- primitives ----------
const RM = "(prefers-reduced-motion: reduce)";
/** Single source of truth for the user's motion preference (SSR-safe, live-updating). */
export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(RM); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(RM).matches,
    () => false,
  );
}

/** 0 → 1 as the element travels through the viewport (rAF-throttled, passive). */
export function useScrollProgress<T extends HTMLElement>(mode: "through" | "sticky" = "through") {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const calc = () => {
      raf = 0; const el = ref.current; if (!el) return;
      const r = el.getBoundingClientRect(), vh = window.innerHeight;
      const v = mode === "sticky" ? -r.top / Math.max(1, r.height - vh) : (vh - r.top) / (vh + r.height);
      setP(Math.min(1, Math.max(0, v)));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(calc); };
    calc(); window.addEventListener("scroll", on, { passive: true }); window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, [mode]);
  return [ref, p] as const;
}

export function useInView<T extends HTMLElement>(threshold = 0.25, once = true) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); if (once) io.disconnect(); } else if (!once) setSeen(false); }, { threshold, rootMargin: "0px 0px -8% 0px" });
    io.observe(el); return () => io.disconnect();
  }, [threshold, once]);
  return [ref, seen] as const;
}

// ---------- Scroll progress bar ----------
export function ScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const h = document.documentElement; setP(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)); }); };
    on(); window.addEventListener("scroll", on, { passive: true }); return () => window.removeEventListener("scroll", on);
  }, []);
  return <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-px origin-left bg-amber" style={{ transform: `scaleX(${p})` }} />;
}

// ---------- Reveal (staggered entrance on view) ----------
export function Reveal({ children, delay = 0, className = "", as: Tag = "div", y = 14 }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" | "p" | "h2"; y?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.15);
  const reduced = useReducedMotion();
  const style: CSSProperties = reduced ? {} : { opacity: seen ? 1 : 0, transform: seen ? "none" : `translateY(${y}px)`, transition: `opacity var(--dur-screen) var(--ease-out) ${delay}ms, transform 520ms var(--ease-out) ${delay}ms` };
  return <Tag ref={ref as never} className={className} style={style}>{children}</Tag>;
}

// ---------- Scroll text reveal (words light up as you scroll) ----------
export function ScrollTextReveal({ text, accent = [], className = "" }: { text: string; accent?: string[]; className?: string }) {
  const [ref, p] = useScrollProgress<HTMLDivElement>("sticky");
  const reduced = useReducedMotion();
  const words = text.split(" ");
  return (
    <div ref={ref} className="relative h-[220vh]">
      <div className="sticky top-0 flex h-screen items-center">
        <p className={className} aria-label={text}>
          {words.map((w, i) => {
            const start = i / words.length * 0.85, on = reduced ? 1 : Math.min(1, Math.max(0, (p - start) / 0.12));
            const hot = accent.some((a) => w.toUpperCase().startsWith(a));
            return <span key={i} aria-hidden className="inline-block transition-[color,opacity] duration-150" style={{ opacity: 0.12 + on * 0.88, color: hot && on > 0.9 ? "#d9c9a8" : undefined }}>{w}&nbsp;</span>;
          })}
        </p>
      </div>
    </div>
  );
}

// ---------- Decode / scramble text (machine "boot" effect on view) ----------
const GLYPHS = "▚▞▖▗▘▝01<>/\\|=+*#@$%";
export function ScrambleText({ text, className = "", speed = 28 }: { text: string; className?: string; speed?: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.6);
  const reduced = useReducedMotion();
  const [frameText, setOut] = useState<string | null>(null);
  const out = !seen || reduced || frameText === null ? text : frameText;
  useEffect(() => {
    if (!seen || reduced) return;
    let frame = 0; const total = text.length + 8;
    const t = setInterval(() => {
      frame++;
      setOut(text.split("").map((c, i) => (c === " " || i < frame - 8 ? c : i < frame ? GLYPHS[(i * 7 + frame) % GLYPHS.length] : "\u00a0")).join(""));
      if (frame >= total) { clearInterval(t); setOut(null); }
    }, speed);
    return () => clearInterval(t);
  }, [seen, reduced, text, speed]);
  return <span ref={ref} className={className} aria-label={text}><span aria-hidden>{out}</span></span>;
}

// ---------- Count up on view ----------
export function CountUp({ to, format, duration = 1400 }: { to: number; format: (n: number) => string; duration?: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.5);
  const reduced = useReducedMotion();
  const [anim, setV] = useState(0);
  const v = reduced ? to : anim;
  useEffect(() => {
    if (!seen || reduced) return;
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => { const k = Math.min(1, (t - t0) / duration); setV(to * (1 - Math.pow(1 - k, 4))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [seen, to, duration, reduced]);
  return <span ref={ref} className="tabular-nums">{format(seen ? v : 0)}</span>;
}

// ---------- Marquee / ticker ----------
export function Marquee({ items, speed = 48 }: { items: ReactNode[]; speed?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className="flex flex-wrap gap-x-10 gap-y-2 px-5 py-4">{items}</div>;
  return (
    <div className="group relative overflow-hidden" style={{ maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" }}>
      <div className="marquee flex w-max gap-10 py-4 group-hover:[animation-play-state:paused]" style={{ animationDuration: `${speed}s` }}>
        {[0, 1].map((k) => <div key={k} className="flex shrink-0 gap-10" aria-hidden={k === 1}>{items}</div>)}
      </div>
    </div>
  );
}

// ---------- Parallax ----------
export function Parallax({ children, speed = 0.25, className = "" }: { children: ReactNode; speed?: number; className?: string }) {
  const [y, setY] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return; let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setY(Math.min(window.scrollY, 1200) * speed); }); };
    window.addEventListener("scroll", on, { passive: true }); return () => window.removeEventListener("scroll", on);
  }, [speed, reduced]);
  return <div className={className} style={{ transform: `translate3d(0, ${y}px, 0)`, willChange: "transform" }}>{children}</div>;
}

// ---------- Cursor spotlight card ----------
export function Spotlight({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`spotlight relative ${className}`}
      onPointerMove={(e) => { const r = ref.current!.getBoundingClientRect(); ref.current!.style.setProperty("--mx", `${e.clientX - r.left}px`); ref.current!.style.setProperty("--my", `${e.clientY - r.top}px`); }}>
      {children}
    </div>
  );
}

// ---------- Sticky scroll steps ----------
export function StickySteps({ steps }: { steps: { n: string; t: string; d: string; detail: string }[] }) {
  const [ref, p] = useScrollProgress<HTMLDivElement>("sticky");
  const active = Math.min(steps.length - 1, Math.floor(p * steps.length));
  return (
    <div ref={ref} className="relative" style={{ height: `${steps.length * 70 + 40}vh` }}>
      <div className="sticky top-0 flex h-screen items-center">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 md:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="label">PROCESS</div>
            <h2 className="mt-3 text-3xl font-medium tracking-tight md:text-5xl">FROM INTENT<br />TO AUTONOMY</h2>
            <div className="relative mt-10 h-px w-full max-w-sm bg-line" aria-hidden><div className="absolute inset-y-0 left-0 bg-amber" style={{ width: `${p * 100}%` }} /></div>
            <ol className="mt-6 space-y-2">{steps.map((s, i) => (
              <li key={s.n} className={`flex items-center gap-4 font-mono text-sm tracking-[.16em] transition-colors duration-[180ms] ${i === active ? "text-fg" : i < active ? "text-mute" : "text-dim"}`} aria-current={i === active ? "step" : undefined}>
                <span className={`${i === active ? "text-amber" : ""}`}>{s.n}</span>{s.t}{i < active && <span className="text-ok">✓</span>}
              </li>))}</ol>
          </div>
          <div className="relative min-h-[300px]">
            {steps.map((s, i) => (
              <div key={s.n} className="absolute inset-0 border border-line bg-bg2 p-8 transition-[opacity,transform] duration-[320ms]" style={{ opacity: i === active ? 1 : 0, transform: i === active ? "none" : `translateY(${i < active ? -16 : 16}px)`, transitionTimingFunction: "var(--ease-out)" }} aria-hidden={i !== active}>
                <div className="font-mono text-xs text-amber">{s.n}</div>
                <div className="mt-6 font-mono text-2xl tracking-[.16em]">{s.t}</div>
                <p className="mt-3 text-lg text-mute">{s.d}</p>
                <pre className="mt-8 whitespace-pre-wrap border-t border-line pt-4 font-mono text-[12px] leading-6 text-fg/80">{s.detail}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Typing terminal ----------
export function TypeTerminal({ lines }: { lines: { t: string; lvl: string; msg: string; c: string }[] }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  const reduced = useReducedMotion();
  const [typed, setN] = useState(0);
  const n = reduced && seen ? lines.length : typed;
  useEffect(() => {
    if (!seen || reduced) return;
    const t = setInterval(() => setN((x) => { if (x >= lines.length) { clearInterval(t); return x; } return x + 1; }), 420);
    return () => clearInterval(t);
  }, [seen, reduced, lines.length]);
  return (
    <div ref={ref} className="border border-line bg-[#070707]">
      <div className="flex items-center justify-between border-b border-line px-4 py-2"><span className="label">MACHINE TERMINAL · RESEARCH-SCOUT</span><span className="flex items-center gap-1.5 font-mono text-[10px] text-ok"><span className="dot-live h-1.5 w-1.5 rounded-full bg-ok text-ok" />{n < lines.length ? "STREAMING" : "COMPLETE"}</span></div>
      <ol className="min-h-[300px] p-4 font-mono text-[12px] leading-6">
        {lines.slice(0, n).map((l, i) => <li key={i} className="fade-up grid grid-cols-[60px_120px_1fr] gap-2"><span className="text-dim">{l.t}</span><span className={l.c}>[{l.lvl}]</span><span className="text-fg/90">{l.msg}</span></li>)}
        {n < lines.length && <li className="text-mute"><span className="caret">▍</span></li>}
      </ol>
    </div>
  );
}
