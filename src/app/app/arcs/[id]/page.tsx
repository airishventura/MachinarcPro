import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getArcDetail } from "@/lib/arcs/queries";
import { validateArc } from "@/lib/arcs/graph";
import { ago } from "@/lib/domain";
import { fmtDuration, fmtUsd } from "@/lib/utils/format";
import { Empty } from "@/components/ui";
import { AutoRefresh } from "@/components/client-bits";
import { ArcConfigForm, ArcControls, ArcStatus, LazyArcCanvas } from "@/components/arcs/arc-client";
import { RunStatus } from "@/components/arcs/run-monitor";

const TABS = [["overview", "Overview"], ["runs", "Runs"], ["builder", "Builder"], ["configuration", "Configuration"]] as const;

export default async function ArcDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab = "overview" }] = await Promise.all([params, searchParams]);
  const { workspace } = await requireSession();
  const d = await getArcDetail(id, workspace.id);
  if (!d) notFound();
  const { arc, graph, machines, runs, status } = d;
  const v = validateArc(graph, machines);
  const machineNodes = graph.nodes.filter((n) => n.type === "machine");
  const missing = machineNodes.filter((n) => n.machineId && !machines.some((m) => m.id === n.machineId) || !n.machineId);
  const finished = runs.filter((r) => r.status === "completed" || r.status === "failed");
  const avg = arc.runsCompleted ? arc.totalDurationMs / arc.runsCompleted : 0;
  const canRun = arc.status === "deployed" && v.valid;

  return (
    <div className="space-y-5">
      {d.activeRunId && <AutoRefresh ms={4000} />}
      <Link href="/app/arcs" className="t-caption inline-block py-1 tracking-widest hover:text-fg">← ARCS</Link>
      <header className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="t-title">{arc.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1"><span className="t-caption">{arc.arcCode}</span><span className="t-caption">{graph.nodes.length} NODES · {machineNodes.length} MACHINES</span><ArcStatus s={status} /></div>
          {arc.description && <p className="t-secondary mt-2 max-w-2xl">{arc.description}</p>}
        </div>
        <ArcControls arcId={arc.id} name={arc.name} status={arc.status} canRun={canRun} activeRunId={d.activeRunId} />
      </header>

      {missing.length > 0 && (
        <div role="alert" className="border border-bad/40 bg-bad/5 p-4"><div className="t-section !text-bad">MACHINE UNAVAILABLE</div><p className="t-secondary mt-1">This Arc references {missing.length > 1 ? `${missing.length} Machines that no longer exist` : "a Machine that no longer exists"} ({missing.map((m) => m.label).join(", ")}). Replace {missing.length > 1 ? "them" : "it"} before deploying.</p><Link href={`/app/arcs/${arc.id}/edit`} className="btn mt-3 hidden md:inline-flex">Open Builder</Link></div>
      )}
      {!v.valid && missing.length === 0 && (
        <div role="alert" className="flex flex-col gap-2 border border-bad/40 bg-bad/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="t-section !text-bad">ARC INVALID</div><p className="t-secondary mt-1">{v.errors} issue{v.errors > 1 ? "s" : ""} must be resolved before deployment.</p></div><Link href={`/app/arcs/${arc.id}/edit`} className="btn hidden md:inline-flex">View Issues</Link></div>
      )}
      {arc.status === "draft" && v.valid && <p className="border-l-2 border-proc pl-3 text-sm text-mute">This Arc is a draft. Use <span className="text-fg">Test Run</span> in the builder, then <span className="text-fg">Deploy</span> to run it from here.</p>}

      <nav className="no-scrollbar -mx-4 flex overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0" aria-label="Arc sections">
        {TABS.map(([k, l]) => (
          <Link key={k} href={k === "builder" ? `/app/arcs/${arc.id}/edit` : `/app/arcs/${arc.id}${k === "overview" ? "" : `?tab=${k}`}`} aria-current={tab === k ? "page" : undefined} className={`relative flex min-h-11 items-center whitespace-nowrap px-4 text-sm ${tab === k ? "text-fg" : "text-mute hover:text-fg"} ${k === "builder" ? "hidden md:flex" : ""}`}>
            {l}{k === "runs" && <span className="ml-1.5 font-mono text-[10px] text-dim">{arc.runsCompleted}</span>}{tab === k && <span className="absolute inset-x-0 -bottom-px h-px bg-amber" />}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="space-y-5">
              <section className="panel p-5"><h2 className="label">Arc Objective</h2><p className="t-body mt-2">{arc.objective || <span className="text-mute">No objective defined.</span>}</p>
                <div className="mt-4 border-t border-line pt-3"><h2 className="label mb-2">Machines</h2>
                  <ul className="flex flex-wrap gap-1.5">{machineNodes.map((n) => { const m = machines.find((x) => x.id === n.machineId); return <li key={n.key}>{m ? <Link href={`/app/machines/${m.id}`} className="block border border-line px-2 py-1 font-mono text-[11px] hover:border-mute">{m.name}<span className="ml-1.5 text-dim">{m.status.toUpperCase()}</span></Link> : <span className="block border border-bad/50 px-2 py-1 font-mono text-[11px] text-bad">{n.label} · UNAVAILABLE</span>}</li>; })}{!machineNodes.length && <li className="t-secondary">No Machines placed yet.</li>}</ul></div>
              </section>
              <dl className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3">
                {[["Status", status.toUpperCase()], ["Nodes", String(graph.nodes.length)], ["Runs", arc.runsCompleted.toLocaleString()], ["Success Rate", arc.runsCompleted ? `${arc.successRate.toFixed(1)}%` : "—"], ["Avg Runtime", avg ? fmtDuration(avg) : "—"], ["Est. Spend", fmtUsd(arc.totalCost)], ["Last Run", arc.lastRunAt ? ago(arc.lastRunAt) : "never"], ["Trigger", arc.triggerType.toUpperCase()], ["Created", arc.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })]].map(([k, val]) => <div key={k} className="bg-bg3 p-3"><dt className="label !text-[9.5px]">{k}</dt><dd className="mt-1 truncate font-mono text-sm tabular-nums">{val}</dd></div>)}
              </dl>
            </div>
            <section aria-label="Arc graph"><div className="mb-2 flex items-center justify-between"><h2 className="label">ARC GRAPH</h2><Link href={`/app/arcs/${arc.id}/edit`} className="t-caption hidden hover:text-fg md:inline">OPEN BUILDER →</Link></div><LazyArcCanvas graph={graph} machines={machines} className="h-[300px] md:h-[380px]" /></section>
          </div>
          <section><div className="mb-2 flex items-center justify-between"><h2 className="label">RECENT RUNS</h2>{runs.length > 5 && <Link href={`/app/arcs/${arc.id}?tab=runs`} className="t-caption hover:text-fg">ALL RUNS →</Link>}</div><RunsTable arcId={arc.id} runs={runs.slice(0, 5)} /></section>
        </div>
      )}
      {tab === "runs" && <RunsTable arcId={arc.id} runs={runs} />}
      {tab === "configuration" && <ArcConfigForm arc={arc} graph={graph} />}
      {tab === "runs" && finished.length > 0 && <p className="t-caption">Showing the latest {runs.length} runs.</p>}
    </div>
  );
}

function RunsTable({ arcId, runs }: { arcId: string; runs: { id: string; code: string; status: string; isTest: boolean; machines: number; durationMs: number; cost: number; createdAt: string; input: string }[] }) {
  if (!runs.length) return <Empty title="NO RUNS YET" body="Run this Arc to see Machines pass work between each other." />;
  return (
    <div className="border border-line">
      <div className="hidden grid-cols-[110px_minmax(0,1fr)_170px_80px_80px_80px_90px] gap-3 border-b border-line px-4 py-2 md:grid">{["Run", "Input", "Status", "Machines", "Duration", "Cost", "Started"].map((h) => <span key={h} className="label">{h}</span>)}</div>
      <ul>{runs.map((r) => (
        <li key={r.id}><Link href={`/app/arcs/${arcId}/runs/${r.id}`} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-line/60 px-4 py-3 last:border-0 hover:bg-panel md:grid-cols-[110px_minmax(0,1fr)_170px_80px_80px_80px_90px] md:items-center">
          <span className="font-mono text-sm">{r.code}{r.isTest && <span className="ml-1.5 text-[9px] tracking-widest text-dim">TEST</span>}</span>
          <span className="order-3 col-span-2 truncate text-sm text-mute md:order-none md:col-span-1">{r.input}</span>
          <span className="justify-self-end md:justify-self-start"><RunStatus s={r.status} /></span>
          <span className="hidden font-mono text-xs md:block">{r.machines}</span>
          <span className="order-4 font-mono text-[11px] text-mute md:order-none">{r.durationMs ? fmtDuration(r.durationMs) : "—"}</span>
          <span className="order-5 justify-self-end font-mono text-[11px] md:order-none md:justify-self-start">{fmtUsd(r.cost)}</span>
          <span className="hidden font-mono text-[11px] text-mute md:block">{ago(r.createdAt)}</span>
        </Link></li>))}</ul>
    </div>
  );
}
