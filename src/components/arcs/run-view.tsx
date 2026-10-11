"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LazyArcCanvas } from "@/components/arcs/arc-client";
import { NodeDetail, RunPanel, RunStatus, runIsActive, useArcRun } from "@/components/arcs/run-monitor";
import { Status } from "@/components/ui";
import { fmtDuration, fmtUsd } from "@/lib/utils/format";
import { HANDLE_LABEL, type MachineRef } from "@/lib/arcs/graph";
import type { ArcRunStateDTO } from "@/types/arc";

const NODE_STATUS: Record<string, string> = { pending: "idle", queued: "queued", running: "running", waiting: "pending", completed: "completed", failed: "failed", skipped: "offline" };

/** Full run inspection: execution canvas, live panel, node executions and trace. */
export function RunView({ arcId, arcName, initial, machines }: { arcId: string; arcName: string; initial: ArcRunStateDTO; machines: MachineRef[] }) {
  const router = useRouter();
  const { state, error, refresh } = useArcRun(arcId, initial.run.id, initial);
  const s = state ?? initial;
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const wasActive = useRef(runIsActive(s.run.status));
  useEffect(() => { const a = runIsActive(s.run.status); if (wasActive.current && !a) router.refresh(); wasActive.current = a; }, [s.run.status, router]);
  const t0 = s.run.startedAt ? new Date(s.run.startedAt).getTime() : 0;
  const path = s.graph.nodes.map((n) => s.nodes.find((r) => r.key === n.key)).filter((r) => r && r.status !== "skipped" && r.status !== "pending");
  const order = [...s.nodes].sort((a, b) => (a.startedAt ? new Date(a.startedAt).getTime() : Infinity) - (b.startedAt ? new Date(b.startedAt).getTime() : Infinity));

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="t-caption">{arcName}{s.run.isTest ? " · TEST RUN" : ""}</div>
          <h1 className="t-title mt-1">{s.run.code}</h1>
          <div className="mt-2"><RunStatus s={s.run.status} /></div>
        </div>
        <dl className="grid grid-cols-3 gap-px border border-line bg-line font-mono text-[11px] md:min-w-[420px]">
          {[["STARTED", s.run.startedAt ? new Date(s.run.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"], ["DURATION", s.run.durationMs ? fmtDuration(s.run.durationMs) : runIsActive(s.run.status) ? "LIVE" : "—"], ["COST", `${fmtUsd(s.run.cost)}`]].map(([k, v]) => <div key={k} className="bg-bg3 p-2.5"><dt className="text-dim">{k}</dt><dd className="mt-0.5 truncate">{v}</dd></div>)}
        </dl>
      </header>
      {error && <p role="status" className="font-mono text-xs text-warn">{error}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <section aria-label="Execution path">
            <div className="mb-2 flex items-center justify-between"><h2 className="label">EXECUTION PATH</h2><span className="t-caption">{path.length} OF {s.nodes.length} NODES EXECUTED · CLICK A NODE TO INSPECT</span></div>
            <LazyArcCanvas graph={s.graph} machines={machines} runNodes={s.nodes} selected={sel} onSelect={setSel} className="h-[300px] md:h-[400px]" />
          </section>
          <section className="panel p-4"><h2 className="label">TRIGGER INPUT</h2><p className="mt-1.5 whitespace-pre-wrap break-words font-mono text-sm">{s.run.input}</p></section>
        </div>
        <aside className="min-w-0"><RunPanel state={s} arcId={arcId} selected={sel} onSelect={setSel} onRefresh={refresh} /></aside>
      </div>

      <section aria-labelledby="ne-h">
        <h2 id="ne-h" className="label mb-2">NODE EXECUTIONS</h2>
        <div className="border border-line">
          <div className="hidden grid-cols-[minmax(0,1.3fr)_110px_150px_80px_80px_minmax(0,1.6fr)_24px] gap-3 border-b border-line px-4 py-2 lg:grid">{["Node", "Type", "Status", "Duration", "Cost", "Output", ""].map((h) => <span key={h} className="label">{h}</span>)}</div>
          <ul>{order.map((n) => (
            <Fragment key={n.key}>
              <li><button onClick={() => setOpen(open === n.key ? null : n.key)} aria-expanded={open === n.key} className={`grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-line/60 px-4 py-2.5 text-left hover:bg-panel lg:grid-cols-[minmax(0,1.3fr)_110px_150px_80px_80px_minmax(0,1.6fr)_24px] lg:items-center ${n.status === "skipped" ? "opacity-55" : ""}`}>
                <span className="truncate font-mono text-sm">{n.label}</span>
                <span className="hidden font-mono text-[10px] tracking-widest text-dim lg:block">{n.type.replace("_", " ").toUpperCase()}</span>
                <span className="justify-self-end lg:justify-self-start"><Status s={NODE_STATUS[n.status] ?? "idle"} />{n.branch && HANDLE_LABEL[n.branch] && <span className="ml-2 font-mono text-[10px] text-amber">{HANDLE_LABEL[n.branch]}</span>}</span>
                <span className="font-mono text-[11px] text-mute">{n.durationMs ? fmtDuration(n.durationMs) : "—"}</span>
                <span className="justify-self-end font-mono text-[11px] lg:justify-self-start">{fmtUsd(n.cost)}</span>
                <span className="col-span-2 truncate font-mono text-[11px] text-mute lg:col-span-1">{n.error ?? (n.output?.replace(/\s+/g, " ").slice(0, 120) || "—")}</span>
                <span className="hidden text-right font-mono text-dim lg:block">{open === n.key ? "−" : "+"}</span>
              </button></li>
              {open === n.key && <li className="fade-up border-b border-line bg-bg2 p-4"><NodeDetail n={n} arcId={arcId} /></li>}
            </Fragment>
          ))}</ul>
        </div>
      </section>

      <section aria-labelledby="tr-h">
        <h2 id="tr-h" className="label mb-2">EXECUTION TRACE</h2>
        <ol className="border border-line bg-[#070707] p-4 font-mono text-[12px] leading-6">
          {s.events.map((e) => (
            <li key={e.id} className="grid grid-cols-[70px_52px_1fr] gap-3 sm:grid-cols-[80px_60px_1fr]">
              <time className="text-dim tabular-nums" dateTime={e.createdAt}>{new Date(e.createdAt).toTimeString().slice(0, 8)}</time>
              <span className="text-dim tabular-nums">+{((new Date(e.createdAt).getTime() - t0) / 1000).toFixed(1)}s</span>
              <button disabled={!e.nodeKey} onClick={() => { if (e.nodeKey) { setSel(e.nodeKey); setOpen(e.nodeKey); } }} className={`break-words text-left ${e.type === "fail" || e.message.startsWith("ARC FAILED") ? "text-bad" : e.type === "decision" ? "text-amber" : e.type === "wait" || e.type === "approval" ? "text-warn" : e.type === "skip" ? "text-dim" : e.message.startsWith("ARC COMPLETED") ? "text-ok" : "text-fg/90"} ${e.nodeKey ? "hover:underline" : ""}`}>{e.message}</button>
            </li>
          ))}
          {runIsActive(s.run.status) && <li className="text-dim"><span className="caret">▍</span></li>}
        </ol>
      </section>
    </div>
  );
}
