"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelArcRunAction, decideArcApprovalAction, retryArcRunAction } from "@/app/arc-actions";
import { Status } from "@/components/ui";
import { fmtDuration, fmtUsd } from "@/lib/utils/format";
import type { ArcRunStateDTO, RunNodeDTO } from "@/types/arc";

const ACTIVE = ["queued", "running", "waiting_delay", "waiting_approval"];
export const runIsActive = (s?: string) => !!s && ACTIVE.includes(s);
const RUN_STATUS: Record<string, string> = { queued: "queued", running: "running", waiting_approval: "pending", waiting_delay: "paused", completed: "completed", failed: "failed", cancelled: "offline" };
export function RunStatus({ s }: { s: string }) {
  return <span className="inline-flex items-center gap-2"><Status s={RUN_STATUS[s] ?? "idle"} />{(s === "waiting_approval" || s === "waiting_delay" || s === "cancelled") && <span className="font-mono text-[10px] tracking-widest text-mute">{s === "waiting_approval" ? "AWAITING APPROVAL" : s === "waiting_delay" ? "DELAYED" : "CANCELLED"}</span>}</span>;
}

/** Polls run telemetry while the run is active. */
export function useArcRun(arcId: string, runId: string | null, initial?: ArcRunStateDTO | null) {
  const [state, setState] = useState<ArcRunStateDTO | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!runId) return;
    try {
      const r = await fetch(`/api/arcs/${arcId}/runs/${runId}`, { cache: "no-store" });
      if (!r.ok) { setError(r.status === 404 ? "Run not found." : "Telemetry unavailable — retrying."); return; }
      setState(await r.json()); setError(null);
    } catch { setError("Connection lost — retrying."); }
  }, [arcId, runId]);
  // Reset telemetry when the observed run changes, then fetch it.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (runId && (!state || state.run.id !== runId)) { setState(null); refresh(); } }, [runId]);
  const status = state?.run.status;
  useEffect(() => {
    if (!runId || (state && !runIsActive(status))) return;
    const t = setInterval(refresh, status === "waiting_approval" ? 3000 : 900);
    return () => clearInterval(t);
  }, [runId, status, refresh, state]);
  return { state, error, refresh };
}

function useElapsed(start: string | null, end: string | null, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  if (!start) return 0;
  return (end ? new Date(end).getTime() : active ? now : new Date(start).getTime()) - new Date(start).getTime();
}
const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

export function ApprovalPanel({ a, nodeLabel, onDone }: { a: ArcRunStateDTO["approvals"][number]; nodeLabel: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const decide = (approve: boolean) => start(async () => { const r = await decideArcApprovalAction(a.id, approve); if (!r.ok) setErr(r.error); onDone(); });
  return (
    <section className="border border-warn/50 bg-warn/5" role="region" aria-label="Operator approval required">
      <div className="border-b border-warn/30 px-3 py-2"><div className="t-section !text-warn">{a.title}</div><div className="t-caption mt-0.5">NODE · {nodeLabel}</div></div>
      <div className="space-y-2 px-3 py-3">
        {a.reason && <p className="text-sm">{a.reason}</p>}
        {a.data && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 font-mono text-[11px] text-fg/85">{a.data}</pre>}
        {err && <p role="alert" className="font-mono text-xs text-bad">{err}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button className="btn btn-danger" disabled={pending} onClick={() => decide(false)}>Reject</button>
          <button className="btn btn-primary" disabled={pending} onClick={() => decide(true)}>{pending ? "Recording…" : "Approve"}</button>
        </div>
        <p className="t-caption">{a.kind === "failure" ? "Approve continues without this node's output. Reject stops the run." : "The Arc Run stays paused until you decide — even across refreshes."}</p>
      </div>
    </section>
  );
}

export function NodeDetail({ n, arcId }: { n: RunNodeDTO; arcId: string }) {
  void arcId;
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-3 gap-px border border-line bg-line font-mono text-[11px]">
        {[["STATUS", n.status.toUpperCase()], ["DURATION", n.durationMs ? fmtDuration(n.durationMs) : "—"], ["COST", fmtUsd(n.cost)]].map(([k, v]) => <div key={k} className="bg-bg3 p-2"><dt className="text-dim">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}
      </dl>
      {n.error && <p className="border-l-2 border-bad pl-2 font-mono text-xs text-bad">{n.error}</p>}
      {n.attemptLog.length > 1 && <div><div className="label mb-1">Attempts</div><ul className="space-y-0.5 font-mono text-[11px]">{n.attemptLog.map((a) => <li key={a.attempt} className={a.status === "completed" ? "text-ok" : "text-bad"}>#{a.attempt} {a.status.toUpperCase()}{a.error ? ` — ${a.error}` : ""}</li>)}</ul></div>}
      <div><div className="label mb-1">Input</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 font-mono text-[11px] text-fg/80">{n.input ?? "—"}</pre></div>
      <div><div className="label mb-1">Output</div><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 font-mono text-[11px] text-fg/90">{n.output || (n.status === "skipped" ? "Not executed — branch not taken." : "—")}</pre></div>
      {n.machineId && n.machineTaskId && <Link className="btn h-8 w-full" href={`/app/machines/${n.machineId}/runs/task-${n.machineTaskId}`}>View Machine Run</Link>}
    </div>
  );
}

/** Live run panel: telemetry, approvals, failure recovery, final output, events and node inspection. */
export function RunPanel({ state, arcId, selected, onSelect, onRefresh, compact, onRetried }: { state: ArcRunStateDTO; arcId: string; selected: string | null; onSelect: (k: string | null) => void; onRefresh: () => void; compact?: boolean; onRetried?: (runId: string) => void }) {
  const router = useRouter();
  const r = state.run;
  const active = runIsActive(r.status);
  const elapsed = useElapsed(r.startedAt, r.completedAt, active);
  const t0 = r.startedAt ? new Date(r.startedAt).getTime() : 0;
  const current = state.nodes.filter((n) => n.status === "running" || n.status === "waiting");
  const done = state.nodes.filter((n) => n.status === "completed").length;
  const pending = state.approvals.filter((a) => a.status === "pending");
  const sel = state.nodes.find((n) => n.key === selected);
  const failedNode = state.nodes.find((n) => n.key === r.failedNodeKey);
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { if (active) listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [state.events.length, active]);

  const retry = () => start(async () => {
    const res = await retryArcRunAction(r.id);
    if (!res.ok) { setErr(res.error); return; }
    if (onRetried) onRetried(res.runId); else router.push(`/app/arcs/${arcId}/runs/${res.runId}`);
  });

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="t-caption">ARC RUN{r.isTest ? " · TEST" : ""}</div><div className="font-mono text-base tracking-wider">{r.code}</div></div>
        <RunStatus s={r.status} />
      </div>
      <dl className="grid grid-cols-2 gap-px border border-line bg-line font-mono text-[11px]">
        {[["ELAPSED", mmss(r.completedAt ? r.durationMs : elapsed)], ["CURRENT", current.map((c) => c.label).join(", ") || (active ? "—" : "DONE")], ["NODES", `${done} / ${state.nodes.filter((n) => n.status !== "skipped").length || state.nodes.length}`], ["COST", `${fmtUsd(r.cost)} · est ${fmtUsd(r.estimatedCost)}`]].map(([k, v]) => <div key={k} className="min-w-0 bg-bg3 p-2"><dt className="text-dim">{k}</dt><dd className="mt-0.5 truncate">{v}</dd></div>)}
      </dl>

      {pending.map((a) => <ApprovalPanel key={a.id} a={a} nodeLabel={state.nodes.find((n) => n.key === a.nodeKey)?.label ?? a.nodeKey} onDone={() => { onRefresh(); router.refresh(); }} />)}

      {r.status === "failed" && (
        <section className="border border-bad/50 bg-bad/5 p-3" role="alert">
          <div className="t-section !text-bad">RUN FAILED</div>
          {failedNode && <p className="mt-2 font-mono text-xs"><span className="text-dim">NODE · </span>{failedNode.label}</p>}
          <p className="mt-1 text-sm text-fg/90"><span className="t-caption">REASON · </span>{r.errorMessage}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {failedNode && <button className="btn h-8" onClick={() => onSelect(failedNode.key)}>View Node</button>}
            <button className="btn btn-primary h-8" disabled={busy} onClick={retry}>{busy ? "Starting…" : "Retry Entire Arc"}</button>
          </div>
        </section>
      )}
      {r.status === "completed" && r.finalOutput && (
        <section className="border border-ok/40">
          <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="t-section !text-ok">FINAL OUTPUT</span>
            <button className="font-mono text-[10px] tracking-widest text-mute hover:text-fg" onClick={async () => { try { await navigator.clipboard.writeText(r.finalOutput ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* blocked */ } }}>{copied ? "COPIED" : "COPY"}</button></div>
          <pre className={`overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-relaxed text-fg/90 ${compact ? "max-h-48" : "max-h-80"}`}>{r.finalOutput}</pre>
          <div className="border-t border-line p-2"><button className="btn h-8" disabled={busy} onClick={retry}>Run Again</button></div>
        </section>
      )}
      {active && <div className="flex justify-end"><button className="font-mono text-[10px] tracking-widest text-dim hover:text-bad" disabled={busy} onClick={() => start(async () => { const x = await cancelArcRunAction(r.id); if (!x.ok) setErr(x.error); onRefresh(); })}>CANCEL RUN</button></div>}
      {err && <p role="alert" className="font-mono text-xs text-bad">{err}</p>}

      {sel ? (
        <section className="border border-line">
          <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="t-section">{sel.label}</span><button className="t-caption hover:text-fg" onClick={() => onSelect(null)} aria-label="Close node details">CLOSE ✕</button></div>
          <div className="p-3"><NodeDetail n={sel} arcId={arcId} /></div>
        </section>
      ) : (
        <section className="flex min-h-0 flex-col border border-line">
          <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="t-section">EVENTS</span><span className="t-caption">Select a node to inspect</span></div>
          <ol ref={listRef} className={`overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5 ${compact ? "max-h-64" : "max-h-96"}`} aria-live="polite">
            {state.events.map((e) => (
              <li key={e.id} className="fade-up grid grid-cols-[42px_1fr] gap-2">
                <span className="text-dim tabular-nums">{mmss(new Date(e.createdAt).getTime() - t0)}</span>
                <button disabled={!e.nodeKey} onClick={() => e.nodeKey && onSelect(e.nodeKey)} className={`text-left ${e.type === "fail" || e.message.startsWith("ARC FAILED") ? "text-bad" : e.type === "decision" ? "text-amber" : e.type === "wait" || e.type === "approval" ? "text-warn" : e.type === "skip" ? "text-dim" : e.message.startsWith("ARC COMPLETED") ? "text-ok" : "text-fg/85"} ${e.nodeKey ? "hover:underline" : ""}`}>{e.message}</button>
              </li>
            ))}
            {active && <li className="text-dim"><span className="caret">▍</span></li>}
          </ol>
        </section>
      )}
    </div>
  );
}
