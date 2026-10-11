"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { decideToolApprovalAction } from "@/app/runtime-actions";
import { toolMeta } from "@/config/tools";
import { fmtDuration, fmtUsd } from "@/lib/utils/format";
import type { ApprovalDTO, TaskResultDTO, ToolExecDTO } from "@/types/machine";

const RISK: Record<string, string> = { low: "text-ok border-ok/40", medium: "text-warn border-warn/50", high: "text-bad border-bad/50" };

/** Impossible-to-miss authorization card. Decisions are made only by authenticated workspace operators. */
export function AuthorizationCard({ a, machineName, onDone }: { a: ApprovalDTO; machineName: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const decide = (d: "deny" | "approve_once" | "approve_run" | "always") => start(async () => { const r = await decideToolApprovalAction(a.id, d); if (!r.ok) setErr(r.error); onDone(); });
  const tool = toolMeta(a.toolId);
  return (
    <section className="fade-up border-2 border-warn bg-warn/[0.06] shadow-[0_0_0_4px_rgba(212,162,76,0.08)]" role="alertdialog" aria-labelledby={`ap-${a.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warn/30 px-4 py-3">
        <h2 id={`ap-${a.id}`} className="t-section !text-warn"><span className="dot-live mr-2 inline-block h-2 w-2 rounded-full bg-warn text-warn" aria-hidden />{a.title}</h2>
        <span className={`border px-2 py-0.5 font-mono text-[10px] tracking-widest ${RISK[a.risk] ?? RISK.medium}`}>RISK · {a.risk.toUpperCase()}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[130px_1fr]">
        <dt className="label">Machine</dt><dd className="font-mono">{machineName}</dd>
        <dt className="label">Requested Tool</dt><dd className="font-mono">{tool?.name ?? a.toolId}</dd>
        {a.destination && <><dt className="label">Destination</dt><dd className="font-mono">{a.destination}</dd></>}
        <dt className="label">Permission</dt><dd className="font-mono">{a.permission}</dd>
        {a.purpose && <><dt className="label">Purpose</dt><dd>{a.purpose}</dd></>}
        <dt className="label">Payload</dt><dd><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 font-mono text-[11px] text-fg/85">{a.payloadSummary || "—"}</pre></dd>
      </dl>
      <p className="px-4 font-mono text-[10px] text-mute">Nothing has been sent. The run is paused until you decide — this persists across refreshes.</p>
      {err && <p role="alert" className="px-4 pt-2 font-mono text-xs text-bad">{err}</p>}
      <div className="grid grid-cols-2 gap-2 p-4 sm:flex sm:justify-end">
        <button className="btn btn-danger" disabled={pending} onClick={() => decide("deny")}>Deny</button>
        <button className="btn btn-primary" disabled={pending} onClick={() => decide("approve_once")}>{pending ? "Recording…" : "Approve Once"}</button>
        <button className="btn" disabled={pending} onClick={() => decide("approve_run")}>Approve for this Run</button>
        {a.persistable && <button className="btn" disabled={pending} onClick={() => { if (confirm(`Always allow ${a.permission} for this Machine? This changes its permissions.`)) decide("always"); }}>Always Allow</button>}
      </div>
    </section>
  );
}

export function ResultView({ r, compact }: { r: TaskResultDTO; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const data = r.structuredData as Record<string, unknown> | null;
  const rows = data ? (Array.isArray((data as { items?: unknown[] }).items) ? ((data as { items: Record<string, unknown>[] }).items) : [data]) : null;
  const cols = rows?.[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="space-y-3">
      {r.simulated && <p className="border border-proc/40 bg-proc/5 px-3 py-2 font-mono text-[11px] text-proc">MOCK RUNTIME · simulated tools — no real external sources were accessed.</p>}
      <p className="text-sm text-fg">{r.summary}</p>
      {rows && cols.length > 0 ? (
        <div className="overflow-x-auto border border-line"><table className="w-full text-xs"><thead><tr className="border-b border-line">{cols.map((c) => <th key={c} className="label px-2 py-1.5 text-left font-normal">{c}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i} className="border-b border-line/50 last:border-0">{cols.map((c) => <td key={c} className="px-2 py-1.5 align-top font-mono">{String(row[c] ?? "—")}</td>)}</tr>)}</tbody></table></div>
      ) : (
        <pre className={`overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-fg/90 ${compact ? "max-h-72" : "max-h-[60vh]"}`}>{r.content}</pre>
      )}
      {r.sources && r.sources.length > 0 && (
        <div><div className="label mb-1">SOURCES · {r.sources.length}</div>
          <ol className="space-y-0.5">{r.sources.slice(0, compact ? 8 : 50).map((s) => <li key={s.id} className="grid grid-cols-[34px_1fr] gap-2 text-xs"><span className="font-mono text-amber">[{s.id}]</span><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-fg/85 underline-offset-2 hover:underline">{s.title || s.url}<span className="ml-2 text-dim">{safeHost(s.url)}</span></a></li>)}</ol>
          {compact && r.sources.length > 8 && <p className="t-caption mt-1">+{r.sources.length - 8} more in the Run Inspector</p>}
        </div>)}
      {r.warnings && r.warnings.length > 0 && <ul className="space-y-0.5">{r.warnings.map((w, i) => <li key={i} className="font-mono text-[11px] text-warn">⚠ {w}</li>)}</ul>}
      <button className="btn h-8" onClick={async () => { try { await navigator.clipboard.writeText(r.content); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* blocked */ } }}>{copied ? "Copied" : "Copy Output"}</button>
    </div>
  );
}
export const safeHost = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

export function ToolDetail({ t, onClose }: { t: ToolExecDTO; onClose?: () => void }) {
  const meta = toolMeta(t.toolId);
  const [full, setFull] = useState(false);
  const out = JSON.stringify(t.output ?? null, null, 2) ?? "null";
  return (
    <section className="border border-line bg-bg3" aria-label={`Tool execution ${t.toolId}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="t-section">{meta?.name ?? t.toolId}</span>{onClose && <button className="t-caption hover:text-fg" onClick={onClose} aria-label="Close tool details">CLOSE ✕</button>}</div>
      <div className="space-y-3 p-3 text-sm">
        <dl className="grid grid-cols-2 gap-px border border-line bg-line font-mono text-[11px] sm:grid-cols-4">
          {[["STATUS", t.status.toUpperCase()], ["PERMISSION", t.permission ? `${t.permission} · ${t.permissionDecision ?? "—"}` : "none"], ["STARTED", t.startedAt ? new Date(t.startedAt).toTimeString().slice(0, 8) : "—"], ["DURATION", t.durationMs ? fmtDuration(t.durationMs) : "—"]].map(([k, v]) => <div key={k} className="min-w-0 bg-bg2 p-2"><dt className="text-dim">{k}</dt><dd className="mt-0.5 truncate">{v}</dd></div>)}
        </dl>
        {t.simulated && <p className="font-mono text-[11px] text-proc">SIMULATED — no real request was made.</p>}
        {t.error && <p className="border-l-2 border-bad pl-2 font-mono text-xs text-bad">{t.error}</p>}
        <div><div className="label mb-1">Input <span className="normal-case text-dim">· secrets redacted</span></div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 font-mono text-[11px]">{JSON.stringify(t.input ?? {}, null, 2)}</pre></div>
        <div><div className="label mb-1">Output preview</div><p className="font-mono text-[11px] text-fg/85">{t.outputPreview ?? "—"}</p></div>
        {t.output != null && <div><button className="btn h-7 text-[10px]" onClick={() => setFull((f) => !f)}>{full ? "Hide Full Result" : "View Full Result"}</button>{full && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 font-mono text-[11px] text-fg/80">{out.slice(0, 40_000)}</pre>}</div>}
      </div>
    </section>
  );
}

export function Telemetry({ run, live, currentAction }: { run: { status: string; turns: number; toolCalls: number; inputTokens: number; outputTokens: number; cost: number; pricingKnown: boolean; memoryCount: number; sourcesCount: number; startedAt: string | null; provider: string; model: string } | null; live: boolean; currentAction: string }) {
  const [now, setNow] = useState(0);
  useEffect(() => { if (!live) return; const tick = () => setNow(Date.now()); const t = setInterval(tick, 1000); const first = setTimeout(tick, 0); return () => { clearInterval(t); clearTimeout(first); }; }, [live]);
  const runtime = run?.startedAt && now ? now - new Date(run.startedAt).getTime() : 0;
  const cells: [string, string][] = [
    ["STATE", run ? run.status.replace(/_/g, " ").toUpperCase() : "IDLE"], ["RUNTIME", run?.startedAt && live ? fmtDuration(runtime) : "—"], ["AI TURNS", String(run?.turns ?? 0)], ["TOOL CALLS", String(run?.toolCalls ?? 0)],
    ["TOKENS", run ? (run.inputTokens + run.outputTokens).toLocaleString() : "0"], ["COST", run ? `${fmtUsd(run.cost)}${run.pricingKnown ? "" : "*"}` : "$0.00"], ["MEMORY", String(run?.memoryCount ?? 0)], ["SOURCES", String(run?.sourcesCount ?? 0)],
  ];
  return (
    <div className="border border-line">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2"><span className="label">CURRENT ACTION</span><span className={`min-w-0 flex-1 truncate font-mono text-xs ${live ? "text-proc" : "text-mute"}`}>{currentAction}</span>{run && <span className="t-caption">{run.provider === "mock" ? "MOCK RUNTIME" : `${run.provider.toUpperCase()} · ${run.model}`}</span>}</div>
      <dl className="grid grid-cols-4 gap-px bg-line sm:grid-cols-8">{cells.map(([k, v]) => <div key={k} className="bg-bg3 px-2.5 py-2"><dt className="label !text-[9px]">{k}</dt><dd className="mt-0.5 truncate font-mono text-[13px] tabular-nums">{v}</dd></div>)}</dl>
    </div>
  );
}

export function FailureBanner({ status, error, errorKind, machineId, runId, onRetry }: { status: string; error: string | null; errorKind: string | null; machineId: string; runId: string; onRetry?: () => void }) {
  const cta = errorKind?.startsWith("provider_auth") || errorKind === "invalid_model" ? <Link className="btn h-8" href="/app/settings/integrations">Update Credentials</Link>
    : status === "budget_exceeded" ? <Link className="btn h-8" href={`/app/machines/${machineId}/runs/${runId}#usage`}>View Usage</Link>
    : /PERMISSION/.test(error ?? "") ? <a className="btn h-8" href="#configuration">Edit Permissions</a> : null;
  const title = status === "budget_exceeded" ? "BUDGET LIMIT REACHED" : status === "timeout" ? "RUN TIMEOUT" : status === "cancelled" ? "RUN CANCELLED" : errorKind?.startsWith("provider") ? "PROVIDER ERROR" : errorKind?.startsWith("limit") || errorKind === "loop_guard" ? "EXECUTION LIMIT REACHED" : "RUN FAILED";
  return (
    <section className={`border p-4 ${status === "cancelled" ? "border-line" : "border-bad/50 bg-bad/5"}`} role="alert">
      <div className={`t-section ${status === "cancelled" ? "" : "!text-bad"}`}>{title}</div>
      <p className="mt-1 text-sm text-fg/90">{(error ?? "").replace(/^[A-Z ]+ — /, "")}</p>
      <div className="mt-3 flex flex-wrap gap-2">{onRetry && <button className="btn btn-primary h-8" onClick={onRetry}>Retry</button>}{cta}<Link className="btn h-8" href={`/app/machines/${machineId}/runs/${runId}`}>Inspect Run</Link></div>
    </section>
  );
}
