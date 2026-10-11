"use client";
import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "@/components/landing/motion";

export function NetworkField() {
  const reduced = useReducedMotion();
  const { nodes, links } = useMemo(() => {
    const seed = { s: 7 };
    const rnd = () => ((seed.s = (seed.s * 9301 + 49297) % 233280) / 233280);
    const nodes = Array.from({ length: 26 }, (_, i) => ({ id: i, x: 40 + rnd() * 720, y: 30 + rnd() * 440, r: rnd() > 0.85 ? 3.5 : 2 }));
    const links: [number, number][] = [];
    nodes.forEach((a) => {
      const near = nodes.filter((b) => b.id !== a.id).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)).slice(0, 2);
      near.forEach((b) => { if (!links.some(([x, y]) => (x === b.id && y === a.id))) links.push([a.id, b.id]); });
    });
    return { nodes, links };
  }, []);
  return (
    <svg viewBox="0 0 800 500" className="h-full w-full" aria-hidden>
      {links.map(([a, b], i) => {
        const A = nodes[a], B = nodes[b];
        const d = `M${A.x},${A.y} L${B.x},${B.y}`;
        return (
          <g key={i}>
            <path d={d} stroke="#2a2c2b" strokeWidth="1" fill="none" />
            {!reduced && i % 3 === 0 && (
              <circle r="1.8" fill="#d9c9a8">
                <animateMotion dur={`${3 + (i % 5)}s`} begin={`${(i % 7) * 0.6}s`} repeatCount="indefinite" path={d} />
              </circle>
            )}
          </g>
        );
      })}
      {nodes.map((n) => (
        <g key={n.id}>
          <rect x={n.x - n.r} y={n.y - n.r} width={n.r * 2} height={n.r * 2} fill={n.r > 3 ? "#f0eee9" : "#8e918f"} />
          {n.r > 3 && <text x={n.x + 8} y={n.y + 3} fill="#5c5f5d" fontSize="8" fontFamily="monospace">M-{(n.id * 977) % 9000 + 1000}</text>}
        </g>
      ))}
    </svg>
  );
}

const ARC = [
  { n: "SIGNAL SCOUT", d: "Scans 140+ sources for weak signals", out: "7 signals" },
  { n: "RESEARCHER", d: "Gathers primary evidence per signal", out: "34 documents" },
  { n: "ANALYST", d: "Scores confidence and novelty", out: "3 high-confidence" },
  { n: "EXECUTOR", d: "Takes action within permissions", out: "2 actions · 0.84 Cr" },
  { n: "REPORTER", d: "Briefs the operator", out: "Report delivered" },
];

export function ArcDemo() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || reduced) return;
    const t = setInterval(() => setActive((a) => (a + 1) % ARC.length), 1800);
    return () => clearInterval(t);
  }, [auto, reduced]);
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]">
      <ol className="relative">
        {ARC.map((s, i) => (
          <li key={s.n}>
            <button onClick={() => { setAuto(false); setActive(i); }} className={`flex w-full items-center gap-4 border px-4 py-3 text-left transition-colors ${i === active ? "border-amber bg-panel" : "border-line hover:border-mute"}`}>
              <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
              <span className="font-mono text-sm tracking-[.14em]">{s.n}</span>
              <span className="ml-auto">{i < active ? <span className="font-mono text-[11px] text-ok">DONE</span> : i === active ? <span className="font-mono text-[11px] text-amber">ACTIVE</span> : <span className="font-mono text-[11px] text-dim">WAIT</span>}</span>
            </button>
            {i < ARC.length - 1 && (
              <div className="relative ml-8 h-6 w-px overflow-hidden bg-line">
                {i === active && <span className={`absolute inset-0 bg-amber ${reduced ? "" : "dot-live"}`} />}
                {i < active && <span className="absolute inset-0 bg-mute" />}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="panel flex flex-col p-6">
        <div className="label">NODE · 0{active + 1}</div>
        <div className="mt-2 text-2xl font-medium">{ARC[active].n}</div>
        <p className="mt-2 text-mute">{ARC[active].d}</p>
        <div className="mt-6 grid grid-cols-2 gap-px bg-line font-mono text-sm">
          <div className="bg-bg3 p-3"><div className="label">INPUT</div><div className="mt-1">{active === 0 ? "Schedule · hourly" : ARC[active - 1].out}</div></div>
          <div className="bg-bg3 p-3"><div className="label">OUTPUT</div><div className="mt-1 text-amber">{ARC[active].out}</div></div>
        </div>
        <p className="mt-auto pt-6 text-sm text-mute">Machines can work alone. Arcs make them work together.</p>
      </div>
    </div>
  );
}
