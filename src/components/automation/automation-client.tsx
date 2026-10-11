"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEventTriggerAction, createScheduleAction, createWebhookAction, deleteEventTriggerAction, deleteScheduleAction, deleteWebhookAction, retryJobAction, runScheduleNowAction, toggleEventTriggerAction, toggleScheduleAction, toggleWebhookAction } from "@/app/automation-actions";

export type TargetOpt = { type: "machine" | "arc"; id: string; name: string };
const enc = (t: TargetOpt) => `${t.type}:${t.id}`;
const dec = (v: string) => { const [type, id] = v.split(":"); return { type, id }; };

function TargetSelect({ id, label, targets, value, onChange }: { id: string; label: string; targets: TargetOpt[]; value: string; onChange: (v: string) => void }) {
  return (
    <div><label htmlFor={id} className="label mb-1 block">{label}</label>
      <select id={id} className="input h-10 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        <optgroup label="Machines">{targets.filter((t) => t.type === "machine").map((t) => <option key={t.id} value={enc(t)}>{t.name}</option>)}</optgroup>
        <optgroup label="Arcs (must be deployed)">{targets.filter((t) => t.type === "arc").map((t) => <option key={t.id} value={enc(t)}>{t.name}</option>)}</optgroup>
      </select></div>
  );
}
function useAct() {
  const r = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => start(async () => { const x = await fn(); if (!x.ok) setErr(x.error ?? "Failed"); else { setErr(""); after?.(); r.refresh(); } });
  return { pending, err, run };
}

export function ScheduleForm({ targets }: { targets: TargetOpt[] }) {
  const { pending, err, run } = useAct();
  const [f, setF] = useState({ name: "", target: "", kind: "interval" as "interval" | "cron", intervalMin: 60, cron: "0 9 * * 1-5", input: "", overlap: "skip" as "skip" | "queue" });
  return (
    <form className="grid gap-3 border border-line bg-bg3 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const t = dec(f.target); run(() => createScheduleAction({ name: f.name, targetType: t.type, targetId: t.id, kind: f.kind, intervalMin: f.intervalMin, cron: f.cron, input: f.input, overlap: f.overlap }), () => setF({ ...f, name: "", input: "" })); }}>
      <div className="t-section md:col-span-2">NEW SCHEDULE</div>
      <div><label htmlFor="s-name" className="label mb-1 block">Name</label><input id="s-name" className="input h-10 text-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Hourly signal scan" /></div>
      <TargetSelect id="s-target" label="Target" targets={targets} value={f.target} onChange={(v) => setF({ ...f, target: v })} />
      <fieldset className="md:col-span-2"><legend className="label mb-1">Cadence</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[["Continuous", 1], ["15 min", 15], ["Hourly", 60], ["Daily", 1440]].map(([l, m]) => <button key={l} type="button" aria-pressed={f.kind === "interval" && f.intervalMin === m} onClick={() => setF({ ...f, kind: "interval", intervalMin: Number(m) })} className={`btn h-9 ${f.kind === "interval" && f.intervalMin === m ? "border-amber text-fg" : "text-mute"}`}>{l}</button>)}
          <button type="button" aria-pressed={f.kind === "cron"} onClick={() => setF({ ...f, kind: "cron" })} className={`btn h-9 ${f.kind === "cron" ? "border-amber text-fg" : "text-mute"}`}>Cron</button>
          {f.kind === "interval" ? <label className="flex items-center gap-2 text-sm">every<input type="number" min={1} max={43200} aria-label="Interval minutes" className="input h-9 w-24 font-mono" value={f.intervalMin} onChange={(e) => setF({ ...f, intervalMin: Number(e.target.value) })} />min</label>
            : <input aria-label="Cron expression" className="input h-9 w-48 font-mono text-sm" value={f.cron} onChange={(e) => setF({ ...f, cron: e.target.value })} placeholder="0 9 * * 1-5" />}
        </div>
        <p className="t-caption mt-1">{f.kind === "cron" ? "5 fields, UTC: minute hour day month weekday" : f.intervalMin === 1 ? "Continuous operation — fires every minute; skipped while the previous run is still active." : "Next run is scheduled relative to the last fire; missed windows are not replayed."}</p>
      </fieldset>
      <div className="md:col-span-2"><label htmlFor="s-input" className="label mb-1 block">Task / trigger input</label><textarea id="s-input" rows={2} className="input text-sm" value={f.input} onChange={(e) => setF({ ...f, input: e.target.value })} placeholder="Scan for new AI infrastructure launches since the last run" /></div>
      <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.overlap === "skip"} onChange={(e) => setF({ ...f, overlap: e.target.checked ? "skip" : "queue" })} className="accent-[#d9c9a8]" />Skip if previous run is active</label></div>
      <div className="flex items-center justify-end gap-3">{err && <span role="alert" className="font-mono text-[11px] text-bad">{err}</span>}<button className="btn btn-primary" disabled={pending || !f.target}>{pending ? "Creating…" : "Create Schedule"}</button></div>
    </form>
  );
}

export function WebhookForm({ targets, origin }: { targets: TargetOpt[]; origin: string }) {
  const { pending, err, run } = useAct();
  const [f, setF] = useState({ name: "", target: "", tpl: "Process this event:\n{{body}}" });
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = token ? `${origin}/api/hooks/${token}` : "";
  return (
    <div className="space-y-3">
      <form className="grid gap-3 border border-line bg-bg3 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const t = dec(f.target); run(async () => { const x = await createWebhookAction({ name: f.name, targetType: t.type, targetId: t.id, inputTemplate: f.tpl }); if (x.ok) setToken(x.token); return x; }); }}>
        <div className="t-section md:col-span-2">NEW WEBHOOK</div>
        <div><label htmlFor="w-name" className="label mb-1 block">Name</label><input id="w-name" className="input h-10 text-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="GitHub issues" /></div>
        <TargetSelect id="w-target" label="Target" targets={targets} value={f.target} onChange={(v) => setF({ ...f, target: v })} />
        <div className="md:col-span-2"><label htmlFor="w-tpl" className="label mb-1 block">Input template · {"{{body}}"} = request body (secrets redacted)</label><textarea id="w-tpl" rows={2} className="input font-mono text-xs" value={f.tpl} onChange={(e) => setF({ ...f, tpl: e.target.value })} /></div>
        <div className="flex items-center justify-end gap-3 md:col-span-2">{err && <span role="alert" className="font-mono text-[11px] text-bad">{err}</span>}<button className="btn btn-primary" disabled={pending || !f.target}>{pending ? "Creating…" : "Create Webhook"}</button></div>
      </form>
      {token && (
        <div className="success-pop border-2 border-ok/60 bg-ok/5 p-4" role="status">
          <div className="t-section !text-ok">WEBHOOK CREATED — COPY THE URL NOW</div>
          <p className="t-secondary mt-1">This URL contains a secret token and will not be shown again.</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all border border-line bg-bg p-2 font-mono text-[11px]">{`curl -X POST ${url} \\\n  -H 'content-type: application/json' \\\n  -d '{"event":"issue.opened","title":"Example"}'`}</pre>
          <div className="mt-2 flex gap-2"><button className="btn h-8" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* blocked */ } }}>{copied ? "Copied" : "Copy URL"}</button><button className="btn h-8" onClick={() => setToken(null)}>Done</button></div>
        </div>
      )}
    </div>
  );
}

export function EventForm({ targets }: { targets: TargetOpt[] }) {
  const { pending, err, run } = useAct();
  const [f, setF] = useState({ name: "", source: "", on: "completed", target: "", tpl: "Continue from this result:\n{{output}}" });
  return (
    <form className="grid gap-3 border border-line bg-bg3 p-4 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); const s = dec(f.source), t = dec(f.target); run(() => createEventTriggerAction({ name: f.name, sourceType: s.type, sourceId: s.id, onStatus: f.on, targetType: t.type, targetId: t.id, inputTemplate: f.tpl }), () => setF({ ...f, name: "" })); }}>
      <div className="t-section md:col-span-3">NEW EVENT TRIGGER</div>
      <TargetSelect id="e-src" label="When" targets={targets} value={f.source} onChange={(v) => setF({ ...f, source: v })} />
      <div><label htmlFor="e-on" className="label mb-1 block">Condition</label><select id="e-on" className="input h-10 text-sm" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })}><option value="completed">completes successfully</option><option value="failed">fails / times out / exceeds budget</option><option value="any">finishes (any outcome)</option></select></div>
      <TargetSelect id="e-tgt" label="Then run" targets={targets} value={f.target} onChange={(v) => setF({ ...f, target: v })} />
      <div className="md:col-span-2"><label htmlFor="e-tpl" className="label mb-1 block">Input template · {"{{output}}"} {"{{status}}"} {"{{source}}"}</label><textarea id="e-tpl" rows={2} className="input font-mono text-xs" value={f.tpl} onChange={(e) => setF({ ...f, tpl: e.target.value })} /></div>
      <div><label htmlFor="e-name" className="label mb-1 block">Name</label><input id="e-name" className="input h-10 text-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Scout → Analyst" /></div>
      <div className="flex items-center justify-end gap-3 md:col-span-3">{err && <span role="alert" className="font-mono text-[11px] text-bad">{err}</span>}<span className="t-caption mr-auto">Chains are capped at 5 hops to prevent trigger loops.</span><button className="btn btn-primary" disabled={pending || !f.source || !f.target}>{pending ? "Creating…" : "Create Trigger"}</button></div>
    </form>
  );
}

type Kind = "schedule" | "webhook" | "event";
export function RowActions({ kind, id, enabled }: { kind: Kind; id: string; enabled: boolean }) {
  const { pending, err, run } = useAct();
  const toggle = kind === "schedule" ? toggleScheduleAction : kind === "webhook" ? toggleWebhookAction : toggleEventTriggerAction;
  const del = kind === "schedule" ? deleteScheduleAction : kind === "webhook" ? deleteWebhookAction : deleteEventTriggerAction;
  return (
    <div className="flex items-center gap-1">
      <button type="button" role="switch" aria-checked={enabled} aria-label={enabled ? "Disable" : "Enable"} disabled={pending} onClick={() => run(() => toggle(id, !enabled))} className={`relative h-6 w-11 shrink-0 border ${enabled ? "border-ok bg-ok/15" : "border-line"}`}><span className={`absolute top-[3px] h-4 w-4 ${enabled ? "left-[22px] bg-ok" : "left-[3px] bg-dim"}`} /></button>
      {kind === "schedule" && <button className="btn h-8 px-2 text-[10px]" disabled={pending} onClick={() => run(() => runScheduleNowAction(id))}>Run now</button>}
      <button className="btn btn-danger h-8 px-2 text-[10px]" disabled={pending} onClick={() => { if (confirm(kind === "webhook" ? "Revoke this webhook? Callers will get 404." : "Delete?")) run(() => del(id)); }}>{kind === "webhook" ? "Revoke" : "Delete"}</button>
      {err && <span role="alert" className="font-mono text-[10px] text-bad">{err}</span>}
    </div>
  );
}

export function RetryJob({ id }: { id: string }) {
  const { pending, run } = useAct();
  return <button className="btn h-7 px-2 text-[10px]" disabled={pending} onClick={() => run(() => retryJobAction(id))}>Retry</button>;
}
