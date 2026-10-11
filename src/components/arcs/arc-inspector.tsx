"use client";
import Link from "next/link";
import { useRef } from "react";
import { HANDLE_LABEL, MAX_DELAY_SECONDS, NODE_META, OPERATORS, availableRefs, delaySeconds, type Graph, type GraphEdge, type GraphNode, type MachineRef, type NodeConfig } from "@/lib/arcs/graph";
import { TYPE_LABEL } from "@/lib/domain";

export type ArcSettings = { name: string; description: string; objective: string; triggerType: string };
type Props = {
  graph: Graph; node: GraphNode | null; edge: GraphEdge | null; machines: MachineRef[]; settings: ArcSettings; readOnly: boolean;
  onSettings: (s: ArcSettings) => void; onUpdate: (key: string, patch: Partial<GraphNode> & { config?: NodeConfig }) => void;
  onDelete: (key: string) => void; onDuplicate: (key: string) => void; onDeleteEdge: (id: string) => void;
};

const Label = ({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) => <label htmlFor={htmlFor} className="label mb-1 block">{children}</label>;

function VarField({ id, label, value, onChange, refs, rows = 4, placeholder, disabled, single }: { id: string; label: string; value: string; onChange: (v: string) => void; refs: string[]; rows?: number; placeholder?: string; disabled?: boolean; single?: boolean }) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const insert = (r: string) => {
    const el = ref.current; const token = `{{${r}}}`;
    if (!el) return onChange(value + token);
    const s = el.selectionStart ?? value.length, e = el.selectionEnd ?? value.length;
    onChange(single ? token : value.slice(0, s) + token + value.slice(e));
    requestAnimationFrame(() => { el.focus(); const p = (single ? 0 : s) + token.length; el.setSelectionRange(p, p); });
  };
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {single ? <input ref={ref} id={id} disabled={disabled} className="input font-mono text-xs" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <textarea ref={ref} id={id} disabled={disabled} rows={rows} className="input font-mono text-xs leading-relaxed" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
      {!disabled && <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Insert variable">
        {refs.map((r) => <button key={r} type="button" onClick={() => insert(r)} className="border border-line px-1.5 py-0.5 font-mono text-[10px] text-mute hover:border-mute hover:text-fg">{`{{${r}}}`}</button>)}
      </div>}
    </div>
  );
}

export function ArcInspector(p: Props) {
  const { node: n, edge, graph, machines, readOnly } = p;
  if (edge) {
    const s = graph.nodes.find((x) => x.key === edge.source), t = graph.nodes.find((x) => x.key === edge.target);
    return (
      <div className="space-y-4">
        <h2 className="t-section">CONNECTION</h2>
        <dl className="space-y-2 font-mono text-xs">
          <div className="flex justify-between gap-2"><dt className="text-dim">SOURCE</dt><dd className="truncate">{s?.label}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-dim">BRANCH</dt><dd>{edge.sourceHandle && HANDLE_LABEL[edge.sourceHandle] ? HANDLE_LABEL[edge.sourceHandle] : "DEFAULT"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-dim">DESTINATION</dt><dd className="truncate">{t?.label}</dd></div>
        </dl>
        <p className="t-secondary">Data flows from {s?.label} to {t?.label}. {t?.label} can reference it as <span className="font-mono text-fg">{`{{${s?.config.alias || s?.label}.output}}`}</span>.</p>
        {!readOnly && <button className="btn btn-danger w-full" onClick={() => p.onDeleteEdge(edge.id)}>Delete Connection</button>}
      </div>
    );
  }
  if (!n) {
    const set = (k: keyof ArcSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => p.onSettings({ ...p.settings, [k]: e.target.value });
    return (
      <div className="space-y-4">
        <h2 className="t-section">ARC SETTINGS</h2>
        <div><Label htmlFor="s-name">Arc Name</Label><input id="s-name" disabled={readOnly} className="input font-mono uppercase" value={p.settings.name} onChange={set("name")} maxLength={60} /></div>
        <div><Label htmlFor="s-desc">Description</Label><input id="s-desc" disabled={readOnly} className="input" value={p.settings.description} onChange={set("description")} /></div>
        <div><Label htmlFor="s-obj">Primary Objective</Label><textarea id="s-obj" disabled={readOnly} rows={3} className="input" value={p.settings.objective} onChange={set("objective")} /></div>
        <div><Label htmlFor="s-trig">Trigger Type</Label>
          <select id="s-trig" disabled={readOnly} className="input" value={p.settings.triggerType} onChange={set("triggerType")}>
            <option value="manual">Manual</option><option value="schedule">Scheduled · run via Automation</option><option value="webhook">Webhook · run via Automation</option><option value="event">Event · run via Automation</option>
          </select></div>
        <div className="border-t border-line pt-3">
          <div className="label mb-2">Execution</div>
          <ul className="t-secondary space-y-1"><li>Mode · <span className="text-fg">Standard</span></li><li>Parallel branches run concurrently</li><li>Joins wait for every parent node</li><li>Delays capped at {MAX_DELAY_SECONDS / 60} min</li></ul>
        </div>
        <p className="t-caption">Select a node or connection to configure it. Press ESC to return here.</p>
      </div>
    );
  }

  const refs = availableRefs(graph, n.key);
  const cfg = (patch: NodeConfig) => p.onUpdate(n.key, { config: { ...n.config, ...patch } });
  const machine = machines.find((m) => m.id === n.machineId);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="t-section">{NODE_META[n.type].label.toUpperCase()} NODE</h2><span className="t-caption">{n.key}</span></div>
      <div><Label htmlFor="n-label">Node Label</Label><input id="n-label" disabled={readOnly} className="input font-mono uppercase" value={n.label} maxLength={60} onChange={(e) => p.onUpdate(n.key, { label: e.target.value.toUpperCase() })} /></div>

      {n.type === "trigger" && <>
        <div><Label htmlFor="n-kind">Trigger</Label>
          <select id="n-kind" disabled={readOnly} className="input" value={n.config.triggerKind ?? "manual"} onChange={(e) => cfg({ triggerKind: e.target.value as NodeConfig["triggerKind"] })}>
            <option value="manual">Manual</option><option value="schedule">Schedule</option><option value="webhook">Webhook</option><option value="event">Event</option>
          </select></div>
        <p className="t-secondary">{n.config.triggerKind && n.config.triggerKind !== "manual" ? "Schedules, webhooks and event triggers for this Arc are configured in Automation and execute on durable workers once the Arc is deployed." : "Run begins when the operator presses Run Arc. The trigger input is available as {{trigger.input}}."}</p>
      </>}

      {n.type === "machine" && <>
        <div><Label htmlFor="n-machine">Machine</Label>
          <select id="n-machine" disabled={readOnly} className="input font-mono text-xs" value={n.machineId ?? ""} onChange={(e) => { const m = machines.find((x) => x.id === e.target.value); p.onUpdate(n.key, { machineId: m?.id ?? null, ...(m && (!n.label || machines.some((x) => x.name === n.label) || n.label === "MACHINE") ? { label: m.name } : {}) }); }}>
            <option value="">Select a Machine…</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.machineCode}{m.status === "paused" ? " · PAUSED" : ""}</option>)}
          </select>
          {n.machineId && !machine && <p className="mt-1 font-mono text-[11px] text-bad">MACHINE UNAVAILABLE — this Machine no longer exists. Replace it before deploying.</p>}
          {machine && <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-dim"><span>{TYPE_LABEL[machine.machineType] ?? machine.machineType} · {machine.status.toUpperCase()}</span><Link href={`/app/machines/${machine.id}`} target="_blank" className="text-mute underline-offset-2 hover:text-fg hover:underline">OPEN MACHINE ↗</Link></div>}
        </div>
        <VarField id="n-instr" label="Task Instruction" disabled={readOnly} value={n.config.instruction ?? ""} onChange={(v) => cfg({ instruction: v })} refs={refs} rows={6} placeholder="Analyze the incoming signal dataset and rank each item by strategic relevance.&#10;&#10;{{trigger.input}}" />
        <p className="t-caption -mt-2">Input mapping · reference upstream data with variables. Empty instruction passes upstream output as-is.</p>
        <div><Label htmlFor="n-alias">Output Alias</Label><input id="n-alias" disabled={readOnly} className="input font-mono text-xs" value={n.config.alias ?? ""} onChange={(e) => cfg({ alias: e.target.value.replace(/[{}.]/g, "") })} placeholder={n.label} /><p className="t-caption mt-1">Downstream: {`{{${n.config.alias || n.label}.output}}`}</p></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="n-fail">On Failure</Label><select id="n-fail" disabled={readOnly} className="input text-xs" value={n.config.onFailure ?? "stop"} onChange={(e) => cfg({ onFailure: e.target.value as NodeConfig["onFailure"] })}><option value="stop">Stop Arc</option><option value="skip">Skip Node</option><option value="review">Send to Human Review</option></select></div>
          <div><Label htmlFor="n-retry">Retries</Label><select id="n-retry" disabled={readOnly} className="input font-mono text-xs" value={n.config.retries ?? 0} onChange={(e) => cfg({ retries: Number(e.target.value) })}>{[0, 1, 2, 3].map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
        </div>
      </>}

      {n.type === "decision" && <>
        <VarField id="n-field" label="Field" single disabled={readOnly} value={n.config.field ?? ""} onChange={(v) => cfg({ field: v })} refs={refs.filter((r) => r.endsWith(".output")).map((r) => `${r}.confidence`).concat(refs)} placeholder="{{ANALYST.output.confidence}}" />
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="n-op">Operator</Label><select id="n-op" disabled={readOnly} className="input text-xs" value={n.config.operator ?? "eq"} onChange={(e) => cfg({ operator: e.target.value as NodeConfig["operator"] })}>{OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.symbol} {o.label}</option>)}</select></div>
          <div><Label htmlFor="n-val">Value</Label><input id="n-val" disabled={readOnly || ["exists", "not_exists"].includes(n.config.operator ?? "")} className="input font-mono text-xs" value={n.config.value ?? ""} onChange={(e) => cfg({ value: e.target.value })} placeholder="0.8" /></div>
        </div>
        <div className="border border-line p-2 font-mono text-[11px]"><span className="text-dim">IF </span>{n.config.field || "…"} {OPERATORS.find((o) => o.key === n.config.operator)?.symbol} {n.config.value}<div className="mt-1"><span className="text-ok">TRUE →</span> {graph.edges.filter((e) => e.source === n.key && e.sourceHandle === "true").map((e) => graph.nodes.find((x) => x.key === e.target)?.label).join(", ") || <span className="text-dim">not connected</span>}</div><div><span className="text-bad">FALSE →</span> {graph.edges.filter((e) => e.source === n.key && e.sourceHandle === "false").map((e) => graph.nodes.find((x) => x.key === e.target)?.label).join(", ") || <span className="text-dim">not connected</span>}</div></div>
        <p className="t-caption">Fields like <span className="text-mute">.confidence</span> are read from JSON or “confidence: 0.82” lines in Machine output. Numbers compare numerically.</p>
      </>}

      {n.type === "human_review" && <>
        <div><Label htmlFor="n-title">Title</Label><input id="n-title" disabled={readOnly} className="input" value={n.config.title ?? ""} onChange={(e) => cfg({ title: e.target.value })} /></div>
        <VarField id="n-reason" label="Reason" disabled={readOnly} rows={3} value={n.config.reason ?? ""} onChange={(v) => cfg({ reason: v })} refs={refs} placeholder="Confidence is below the autonomous execution threshold." />
        <VarField id="n-display" label="Data to display" disabled={readOnly} rows={3} value={n.config.display ?? ""} onChange={(v) => cfg({ display: v })} refs={refs} placeholder="Defaults to upstream output" />
        <p className="t-caption">APPROVE and REJECT paths are the node&apos;s two outputs. The run pauses until an operator decides.</p>
      </>}

      {n.type === "delay" && <>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="n-dur">Duration</Label><input id="n-dur" type="number" min={1} disabled={readOnly} className="input font-mono" value={n.config.duration ?? 10} onChange={(e) => cfg({ duration: Math.max(0, Number(e.target.value)) })} /></div>
          <div><Label htmlFor="n-unit">Unit</Label><select id="n-unit" disabled={readOnly} className="input" value={n.config.unit ?? "seconds"} onChange={(e) => cfg({ unit: e.target.value as NodeConfig["unit"] })}><option value="seconds">seconds</option><option value="minutes">minutes</option><option value="hours">hours</option></select></div>
        </div>
        {delaySeconds(n.config) > MAX_DELAY_SECONDS && <p className="font-mono text-[11px] text-bad">Delays are limited to 1 hour in this release.</p>}
        <p className="t-caption">Delay state is persisted. The run resumes when the duration elapses — no server process is blocked.</p>
      </>}

      {n.type === "output" && <>
        <div><Label htmlFor="n-oname">Output Name</Label><input id="n-oname" disabled={readOnly} className="input font-mono uppercase" value={n.config.outputName ?? ""} onChange={(e) => cfg({ outputName: e.target.value.toUpperCase() })} /></div>
        <VarField id="n-tpl" label="Content Template" disabled={readOnly} rows={6} value={n.config.template ?? ""} onChange={(v) => cfg({ template: v })} refs={refs} placeholder="{{ANALYST.output}}" />
      </>}

      {!readOnly && (
        <div className="grid grid-cols-2 gap-2 border-t border-line pt-4">
          <button className="btn h-9" disabled={n.type === "trigger"} onClick={() => p.onDuplicate(n.key)}>Duplicate</button>
          <button className="btn btn-danger h-9" onClick={() => p.onDelete(n.key)}>Delete</button>
        </div>
      )}
    </div>
  );
}
