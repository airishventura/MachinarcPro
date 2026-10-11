"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useActionState, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createArcAction, deleteArcAction, deployArcAction, runArcAction, saveArcAction, setArcPausedAction, applyArcTemplateAction } from "@/app/arc-actions";
import { Empty, Status } from "@/components/ui";
import { ago } from "@/lib/domain";
import type { ArcTemplate } from "@/config/arc-templates";
import type { Check, Graph } from "@/lib/arcs/graph";
import type { ArcCardDTO } from "@/types/arc";

const skeleton = (h: string) => function Loading() { return <div className={`skeleton border border-line ${h}`} aria-label="Loading canvas" />; };
export const LazyArcCanvas = dynamic(() => import("@/components/arcs/arc-canvas-view"), { ssr: false, loading: skeleton("h-[320px]") });
export const LazyArcBuilder = dynamic(() => import("@/components/arcs/arc-builder"), { ssr: false, loading: skeleton("h-[calc(100dvh-8.5rem)] min-h-[560px]") });

export const ARC_STATUS: Record<string, string> = { running: "running", waiting: "pending", idle: "online", draft: "draft", failed: "failed", paused: "paused", disabled: "offline" };
export function ArcStatus({ s }: { s: string }) {
  return <span className="inline-flex items-center gap-2"><Status s={ARC_STATUS[s] ?? "idle"} />{s === "idle" && <span className="font-mono text-[10px] tracking-widest text-mute">DEPLOYED</span>}{s === "waiting" && <span className="font-mono text-[10px] tracking-widest text-mute">APPROVAL</span>}</span>;
}

const FILTERS = ["all", "running", "idle", "draft", "failed", "paused"] as const;
export function ArcList({ rows, initial }: { rows: ArcCardDTO[]; initial: { status: string; q: string; view: "grid" | "list" } }) {
  const router = useRouter(); const path = usePathname();
  const [f, setF] = useState(initial.status); const [q, setQ] = useState(initial.q); const [view, setView] = useState(initial.view);
  const sync = (n: { status?: string; q?: string; view?: string }) => {
    const p = new URLSearchParams(); const st = n.status ?? f, qq = n.q ?? q, v = n.view ?? view;
    if (st !== "all") p.set("status", st); if (qq) p.set("q", qq); if (v !== "grid") p.set("view", v);
    router.replace(`${path}${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  const match = (r: ArcCardDTO, s: string) => s === "all" || r.status === s || (s === "running" && r.status === "waiting");
  const list = useMemo(() => rows.filter((r) => match(r, f) && `${r.name} ${r.arcCode} ${r.description} ${r.chain.join(" ")}`.toLowerCase().includes(q.toLowerCase())), [rows, f, q]);
  if (!rows.length) return <Empty title="NO ARCS CREATED" body="Machines can work independently. Arcs let them work together. Connect Machines into an autonomous system." href="/app/arcs/new" cta="Create Arc" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="no-scrollbar flex overflow-x-auto border border-line" role="tablist" aria-label="Filter Arcs">
          {FILTERS.map((x) => <button key={x} role="tab" aria-selected={f === x} onClick={() => { setF(x); sync({ status: x }); }} className={`min-h-10 px-3.5 font-mono text-[11px] tracking-widest ${f === x ? "bg-fg text-bg" : "text-mute hover:text-fg"}`}>{x.toUpperCase()} <span className="opacity-60">{rows.filter((r) => match(r, x)).length}</span></button>)}
        </div>
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); sync({ q: e.target.value }); }} placeholder="Search Arcs, codes, Machines…" aria-label="Search Arcs" className="input h-10 md:ml-auto md:max-w-xs" />
        <div className="flex border border-line">{(["grid", "list"] as const).map((v) => <button key={v} onClick={() => { setView(v); sync({ view: v }); }} aria-pressed={view === v} className={`min-h-10 px-3 font-mono text-[11px] ${view === v ? "bg-panel2 text-fg" : "text-mute"}`}>{v.toUpperCase()}</button>)}</div>
      </div>
      {!list.length ? <Empty title="NO MATCHING ARCS" body="No Arcs match this filter. Adjust the status or search query." /> : view === "grid" ? (
        <div className="stagger grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <Link key={a.id} href={`/app/arcs/${a.id}`} className="card-hover flex flex-col bg-bg3 p-4 hover:bg-panel">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-mono tracking-wider">{a.name}</div><div className="t-caption">{a.arcCode} · {a.nodesCount} NODES</div></div><ArcStatus s={a.status} /></div>
              {a.description && <p className="t-secondary mt-2 line-clamp-1">{a.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-1 font-mono text-[10.5px]">
                {a.chain.slice(0, 5).map((c, i) => <span key={i} className="flex items-center gap-1"><span className="border border-line px-1.5 py-0.5 text-fg/85">{c}</span>{i < Math.min(5, a.chain.length) - 1 && <span className="text-dim">→</span>}</span>)}
                {a.chain.length > 5 && <span className="text-dim">+{a.chain.length - 5}</span>}
              </div>
              <div className="mt-2 h-4 truncate font-mono text-[10.5px] text-proc">{a.activity ? `▸ ${a.activity}` : ""}</div>
              <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-line pt-3">
                {[["RUNS", a.runsCompleted.toLocaleString()], ["SUCCESS", a.runsCompleted ? `${a.successRate.toFixed(1)}%` : "—"], ["LAST RUN", a.lastRunAt ? ago(a.lastRunAt).toUpperCase() : "NEVER"]].map(([k, v]) => <div key={k}><dt className="label !text-[9.5px]">{k}</dt><dd className="mt-0.5 font-mono text-xs tabular-nums">{v}</dd></div>)}
              </dl>
            </Link>
          ))}
        </div>
      ) : (
        <div className="border border-line">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_130px_70px_80px_90px] gap-3 border-b border-line px-4 py-2 md:grid">{["Arc", "Machines", "Status", "Runs", "Success", "Last run"].map((h) => <span key={h} className="label">{h}</span>)}</div>
          <ul>{list.map((a) => (
            <li key={a.id}><Link href={`/app/arcs/${a.id}`} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-line/60 px-4 py-3 last:border-0 hover:bg-panel md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_130px_70px_80px_90px] md:items-center">
              <span className="min-w-0"><span className="block truncate font-mono text-sm">{a.name}</span><span className="t-caption">{a.arcCode}</span></span>
              <span className="order-3 col-span-2 truncate font-mono text-[11px] text-mute md:order-none md:col-span-1">{a.chain.join(" → ") || "—"}</span>
              <span className="justify-self-end md:justify-self-start"><ArcStatus s={a.status} /></span>
              <span className="hidden font-mono text-xs md:block">{a.runsCompleted}</span><span className="hidden font-mono text-xs md:block">{a.runsCompleted ? `${a.successRate.toFixed(1)}%` : "—"}</span><span className="hidden font-mono text-[11px] text-mute md:block">{a.lastRunAt ? ago(a.lastRunAt) : "never"}</span>
            </Link></li>))}</ul>
        </div>
      )}
    </div>
  );
}

export function TemplateGrid({ templates }: { templates: ArcTemplate[] }) {
  const [preview, setPreview] = useState<ArcTemplate | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const use = (k: string) => start(async () => { const r = await applyArcTemplateAction(k); if (r && !r.ok) setErr(r.error); });
  return (
    <>
      {err && <p role="alert" className="mb-2 font-mono text-xs text-bad">{err}</p>}
      <div className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {templates.map((t) => (
          <div key={t.key} className="flex flex-col bg-bg3 p-4">
            <div className="font-mono text-sm tracking-wider">{t.name}</div>
            <div className="t-caption mt-0.5">{t.nodes.length} NODES · {t.nodes.filter((n) => n.machine).length} MACHINES</div>
            <p className="t-secondary mt-2 flex-1">{t.description}</p>
            <div className="mt-3 grid grid-cols-2 gap-2"><button className="btn h-8" onClick={() => setPreview(t)}>Preview</button><button className="btn btn-primary h-8" disabled={pending} onClick={() => use(t.key)}>{pending ? "Copying…" : "Use Template"}</button></div>
          </div>
        ))}
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal aria-labelledby="tpl-title" onKeyDown={(e) => e.key === "Escape" && setPreview(null)}>
          <div className="absolute inset-0 bg-black/75" onClick={() => setPreview(null)} />
          <div className="fade-up relative w-full max-w-3xl border border-line bg-bg3 p-5">
            <div className="flex items-start justify-between gap-4"><div><h2 id="tpl-title" className="t-section !text-base">{preview.name}</h2><p className="t-secondary mt-1">{preview.objective}</p></div><button autoFocus className="t-caption hover:text-fg" onClick={() => setPreview(null)} aria-label="Close">✕</button></div>
            <div className="mt-4"><LazyArcCanvas graph={templateGraph(preview)} machines={[]} className="h-[300px]" controls={false} /></div>
            <p className="t-caption mt-3">Machines in this template are created in your workspace (or reused if one with the same name exists). Everything stays editable.</p>
            <div className="mt-4 flex justify-end gap-2"><button className="btn" onClick={() => setPreview(null)}>Close</button><button className="btn btn-primary" disabled={pending} onClick={() => use(preview.key)}>{pending ? "Copying…" : "Use Template"}</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function templateGraph(t: ArcTemplate): Graph {
  // Simple left-to-right layering for preview only.
  const layer = new Map<string, number>([[t.nodes[0].key, 0]]);
  for (let i = 0; i < t.nodes.length; i++) for (const [s, d] of t.edges) layer.set(d, Math.max(layer.get(d) ?? 0, (layer.get(s) ?? 0) + 1));
  const rows = new Map<number, number>();
  return {
    nodes: t.nodes.map((n) => { const l = layer.get(n.key) ?? 0; const r = rows.get(l) ?? 0; rows.set(l, r + 1); return { key: n.key, type: n.type, label: n.label, machineId: null, x: l * 280, y: r * 140, config: n.config ?? {} }; }),
    edges: t.edges.map(([s, d, h], i) => ({ id: `p${i}`, source: s, target: d, sourceHandle: h ?? "out" })),
  };
}

export function NewArcForm() {
  const [state, action, pending] = useActionState(createArcAction, undefined);
  const [trigger, setTrigger] = useState("manual");
  return (
    <form action={action} className="panel space-y-5 p-5 md:p-7">
      <div><label htmlFor="name" className="label mb-1.5 block">Arc Name</label><input id="name" name="name" required minLength={3} maxLength={60} autoFocus className="input font-mono uppercase" placeholder="MARKET INTELLIGENCE ARC" /></div>
      <div><label htmlFor="description" className="label mb-1.5 block">Description</label><input id="description" name="description" className="input" placeholder="Scout → Researcher → Analyst → Reporter" /></div>
      <div><label htmlFor="objective" className="label mb-1.5 block">Primary Objective</label><textarea id="objective" name="objective" rows={3} className="input" placeholder="Continuously surface and rank emerging AI infrastructure opportunities." /></div>
      <fieldset><legend className="label mb-1.5">Trigger Type</legend>
        <input type="hidden" name="triggerType" value={trigger} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["manual", "Manual", "Fully executable"], ["schedule", "Scheduled", "Configure in Automation"], ["webhook", "Webhook", "Configure in Automation"], ["event", "Event", "Configure in Automation"]].map(([k, l, s]) => (
          <button key={k} type="button" aria-pressed={trigger === k} onClick={() => setTrigger(k)} className={`border px-3 py-2.5 text-left ${trigger === k ? "border-amber bg-panel" : "border-line hover:border-mute"}`}><span className="block font-mono text-xs">{l}</span><span className={`block font-mono text-[10px] ${k === "manual" ? "text-ok" : "text-dim"}`}>{s}</span></button>
        ))}</div>
      </fieldset>
      {state?.error && <p role="alert" className="border border-bad/40 bg-bad/5 px-3 py-2 font-mono text-xs text-bad">{state.error}</p>}
      <div className="flex justify-end border-t border-line pt-5"><button className="btn btn-primary h-11 px-6" disabled={pending}>{pending ? "Creating…" : "Create Arc"}</button></div>
    </form>
  );
}

export function ArcControls({ arcId, name, status, canRun, activeRunId }: { arcId: string; name: string; status: string; canRun: boolean; activeRunId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const deploy = () => start(async () => { const r = await deployArcAction(arcId); if (r.ok) { setMsg(`ARC DEPLOYED — ${name} is now ready for execution.`); setChecks(null); router.refresh(); } else { setErr(r.error); setChecks(r.checks ?? null); } });
  const pause = (p: boolean) => start(async () => { const r = await setArcPausedAction(arcId, p); if (!r.ok) setErr(r.error); router.refresh(); });
  const run = () => start(async () => { const r = await runArcAction(arcId, input); if (!r.ok) { setErr(r.error); return; } router.push(`/app/arcs/${arcId}/runs/${r.runId}`); });
  return (
    <div className="flex flex-col items-stretch gap-2 md:items-end">
      <div className="grid grid-cols-2 gap-2 sm:flex">
        {activeRunId && <Link className="btn border-proc/50 text-proc" href={`/app/arcs/${arcId}/runs/${activeRunId}`}>View Live Run</Link>}
        <button className="btn btn-primary" disabled={!canRun || pending} onClick={() => { setErr(""); setOpen(true); }} title={canRun ? "" : status === "paused" ? "Resume the Arc to run it" : "Deploy the Arc first"}>Run Arc</button>
        <Link className="btn hidden md:inline-flex" href={`/app/arcs/${arcId}/edit`}>Edit Arc</Link>
        {status === "draft" ? <button className="btn" disabled={pending} onClick={deploy}>Deploy</button> : status === "paused" ? <button className="btn" disabled={pending} onClick={() => pause(false)}>Resume</button> : <button className="btn" disabled={pending} onClick={() => pause(true)}>Pause</button>}
      </div>
      {status === "paused" && <p className="t-caption md:text-right">PAUSED · active runs finish, new runs are blocked.</p>}
      {msg && <p role="status" className="fade-up font-mono text-xs text-ok">{msg}</p>}
      {err && !open && <div role="alert" className="max-w-md border border-bad/40 bg-bad/5 p-3 font-mono text-xs text-bad">{err}{checks && <ul className="mt-2 space-y-0.5 text-fg/80">{checks.filter((c) => c.level === "error").map((c, i) => <li key={i}>✕ {c.message}</li>)}</ul>}{checks && <Link href={`/app/arcs/${arcId}/edit`} className="mt-2 inline-block underline">VIEW ISSUES IN BUILDER</Link>}</div>}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal aria-labelledby="run-title" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="absolute inset-0 bg-black/75" onClick={() => setOpen(false)} />
          <form className="fade-up relative w-full max-w-lg border border-line bg-bg3 p-5 text-left" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <div className="t-caption">{name}</div>
            <h2 id="run-title" className="t-section mt-1 !text-base">RUN ARC</h2>
            <label htmlFor="trigger-input" className="label mt-4 block">Trigger Input</label>
            <textarea id="trigger-input" autoFocus rows={4} className="input mt-1.5" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Analyze this topic: “Emerging decentralized AI infrastructure projects.”" />
            <div className="mt-3 flex items-center justify-between border border-line px-3 py-2"><span className="label">Execution Mode</span><span className="font-mono text-xs">STANDARD</span></div>
            {err && <p role="alert" className="mt-3 font-mono text-xs text-bad">{err}</p>}
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={pending || !input.trim()}>{pending ? "Starting…" : "Start Arc"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

export function ArcConfigForm({ arc, graph }: { arc: { id: string; name: string; description: string; objective: string; triggerType: string }; graph: Graph }) {
  const router = useRouter();
  const [f, setF] = useState({ name: arc.name, description: arc.description, objective: arc.objective, triggerType: arc.triggerType });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <form className="panel space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveArcAction(arc.id, graph, f); setMsg(r.ok ? { ok: true, t: "CONFIGURATION SAVED" } : { ok: false, t: r.error }); router.refresh(); }); }}>
        <h2 className="t-section">ARC CONFIGURATION</h2>
        <div><label htmlFor="c-name" className="label mb-1.5 block">Arc Name</label><input id="c-name" className="input font-mono uppercase" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label htmlFor="c-desc" className="label mb-1.5 block">Description</label><input id="c-desc" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div><label htmlFor="c-obj" className="label mb-1.5 block">Primary Objective</label><textarea id="c-obj" rows={3} className="input" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></div>
        <div><label htmlFor="c-trig" className="label mb-1.5 block">Trigger Type</label><select id="c-trig" className="input" value={f.triggerType} onChange={(e) => setF({ ...f, triggerType: e.target.value })}><option value="manual">Manual</option><option value="schedule">Scheduled · run via Automation</option><option value="webhook">Webhook · run via Automation</option><option value="event">Event · run via Automation</option></select></div>
        {msg && <p role="status" className={`font-mono text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.t}</p>}
        <div className="flex justify-end border-t border-line pt-4"><button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save Configuration"}</button></div>
      </form>
      <div className="border border-bad/40 p-5">
        <div className="t-section !text-bad">DELETE ARC</div>
        <p className="t-secondary mt-2">Removes the Arc from your workspace. Run history is retained. Machines are not affected. Arcs with an active run cannot be deleted.</p>
        {msg && !msg.ok && null}
        <button className="btn btn-danger mt-4" disabled={pending} onClick={() => { if (confirm(`Delete ${arc.name}?`)) start(async () => { const r = await deleteArcAction(arc.id); if (r && !r.ok) setMsg({ ok: false, t: r.error }); }); }}>Delete Arc</button>
      </div>
    </div>
  );
}
