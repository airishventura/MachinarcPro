"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deployMachineAction, retryDeployAction } from "@/app/actions";
import { TYPE_LABEL, machineCode } from "@/lib/domain";
import { BUILDER_TYPES, draftDefaults, type MachineDraft } from "@/lib/machines/drafts";
import { CAPABILITY_LABEL, MODELS, PROVIDERS, type ProviderId } from "@/config/models";
import { MEMORY_MODES, PERMISSIONS, TOOL_CATALOG, type OutputField, type PermissionMode } from "@/config/tools";
import type { MachineStateDTO } from "@/types/machine";
import { Glyph } from "@/components/ui";

const STAGES = [
  { key: "IDENTITY", hint: "Who is this Machine?" }, { key: "OBJECTIVE", hint: "What does it exist to do?" }, { key: "INTELLIGENCE", hint: "How does it think?" },
  { key: "TOOLS", hint: "What can it touch?" }, { key: "MEMORY", hint: "What does it retain?" }, { key: "CONTROL", hint: "What is it allowed to do?" }, { key: "REVIEW", hint: "Confirm and deploy" },
];
const INIT_STEPS = ["Generating identity", "Loading intelligence", "Applying permissions", "Initializing runtime", "Registering Machine"];
const CATS = ["RESEARCH", "DATA", "DEVELOPER", "MACHINARC"] as const;
export type Availability = { openai: string | null; anthropic: string | null; mock: string; customApis: { slug: string; name: string; actions: number; status: string }[] };

export function MachineBuilder({ initial, available }: { initial?: Partial<MachineDraft>; available: Availability }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const firstReal = available.openai ? "openai" : available.anthropic ? "anthropic" : "mock";
  const [d, setD] = useState<MachineDraft>(() => {
    const base = draftDefaults({ modelProvider: firstReal, modelName: MODELS.find((m) => m.provider === firstReal)!.id, ...initial });
    return { ...base, tools: [...base.tools, ...available.customApis.filter((a) => !base.tools.some((t) => t.id === `api__${a.slug}`)).map((a) => ({ id: `api__${a.slug}`, enabled: false }))] };
  });
  const [deploy, setDeploy] = useState<null | { id?: string; done: number; status: "submitting" | "initializing" | "online" | "failed" }>(null);
  // Machine ID is random: generated client-side after mount to avoid a hydration mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setD((p) => ({ ...p, machineCode: machineCode(p.machineType) })); }, [d.machineType]);
  const up = <K extends keyof MachineDraft>(k: K, v: MachineDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const tool = (id: string) => d.tools.find((t) => t.id === id);
  const setTool = (id: string, patch: Partial<MachineDraft["tools"][number]>) => setD((p) => ({ ...p, tools: p.tools.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const model = MODELS.find((m) => m.provider === d.modelProvider && m.id === d.modelName);
  const connected = (p: string) => p === "mock" || !!available[p as "openai" | "anthropic"];

  const validate = (s: number) => {
    if (s === 0 && d.name.trim().length < 2) return "Name your Machine (at least 2 characters).";
    if (s === 1 && d.objective.trim().length < 10) return "Describe the objective (at least 10 characters).";
    if (s === 2 && d.outputMode === "structured" && !(d.outputSchema?.fields.length)) return "Add at least one output field.";
    if (s === 2 && d.outputMode === "structured" && d.outputSchema!.fields.some((f) => !/^[a-z][a-z0-9_]{0,39}$/.test(f.key))) return "Field keys must be lowercase snake_case.";
    if (s === 5 && d.monthlyBudget < d.dailyBudget) return "Monthly budget must be at least the daily budget.";
    if (s === 5 && (d.maxTaskCost <= 0 || (d.dailyBudget > 0 && d.maxTaskCost > d.dailyBudget))) return "Max task cost must be > 0 and not exceed the daily budget.";
    return "";
  };
  const go = (to: number) => { if (to > step) for (let i = step; i < to; i++) { const e = validate(i); if (e) { setErr(e); setStep(i); return; } } setErr(""); setStep(to); };

  useEffect(() => {
    if (!deploy?.id || deploy.status !== "initializing") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/machines/${deploy.id}/state`, { cache: "no-store" });
      if (!r.ok) return;
      const s: MachineStateDTO = await r.json();
      const done = s.logs.filter((l) => l.message.endsWith("… OK")).length;
      if (s.machine.status === "idle") setDeploy((p) => p && { ...p, done: INIT_STEPS.length, status: "online" });
      else if (s.machine.status === "failed") setDeploy((p) => p && { ...p, status: "failed" });
      else setDeploy((p) => p && { ...p, done });
    }, 350);
    return () => clearInterval(t);
  }, [deploy?.id, deploy?.status]);
  useEffect(() => { if (deploy?.status === "online" && deploy.id) { const t = setTimeout(() => router.push(`/app/machines/${deploy.id}`), 1200); return () => clearTimeout(t); } }, [deploy?.status, deploy?.id, router]);

  async function submit() {
    for (let i = 0; i < 6; i++) { const e = validate(i); if (e) { setErr(e); setStep(i); return; } }
    setDeploy({ done: 0, status: "submitting" });
    const res = await deployMachineAction(d);
    if ("error" in res) { setDeploy(null); setErr(res.error); if (res.error.includes("collision")) up("machineCode", machineCode(d.machineType)); return; }
    setDeploy({ id: res.id, done: 0, status: "initializing" });
  }

  if (deploy) {
    const online = deploy.status === "online";
    return (
      <div className="grid-bg flex min-h-[65vh] items-center justify-center border border-line" role="status" aria-live="polite">
        <div className="w-full max-w-md p-6 sm:p-8">
          <div className="flex items-center gap-4"><Glyph code={d.machineCode} size={48} active={online} /><div><div className="font-mono text-lg tracking-wider">{d.name.toUpperCase()}</div><div className="t-caption">{d.machineCode}</div></div></div>
          <div className={`t-section mt-8 ${online ? "!text-ok" : deploy.status === "failed" ? "!text-bad" : ""}`}>{online ? "MACHINE ONLINE" : deploy.status === "failed" ? "INITIALIZATION FAILED" : "INITIALIZING MACHINE"}</div>
          <div className="relative mt-3 h-px bg-line"><div className="progress-glide absolute inset-y-0 left-0 bg-amber" style={{ width: `${(deploy.done / INIT_STEPS.length) * 100}%` }} /></div>
          <ol className="mt-6 space-y-2 font-mono text-xs">{INIT_STEPS.map((l, i) => <li key={l} className={`flex justify-between ${i < deploy.done ? "text-mute" : i === deploy.done && !online ? "text-fg" : "text-dim"}`}><span>{l}…</span><span>{i < deploy.done ? <span className="text-ok">OK</span> : i === deploy.done && deploy.status !== "failed" ? <span className="caret">▍</span> : ""}</span></li>)}</ol>
          {online && <div className="success-pop mt-8 flex items-center gap-2 font-mono text-xs text-ok"><span className="dot-live h-2 w-2 rounded-full bg-ok" />Runtime started. Opening Machine…</div>}
          {deploy.status === "failed" && deploy.id && <div className="mt-8 flex gap-2"><button className="btn btn-primary" onClick={async () => { await retryDeployAction(deploy.id!); setDeploy({ ...deploy, done: 0, status: "initializing" }); }}>Retry initialization</button><Link className="btn" href={`/app/machines/${deploy.id}`}>Open Machine</Link></div>}
        </div>
      </div>
    );
  }

  const enabledTools = d.tools.filter((t) => t.enabled);
  const fields = d.outputSchema?.fields ?? [];
  const setFields = (f: OutputField[]) => up("outputSchema", { name: d.outputSchema?.name || "Result", list: d.outputSchema?.list ?? false, fields: f });

  return (
    <div className="grid gap-6 lg:grid-cols-[190px_minmax(0,1fr)_260px]">
      <ol className="no-scrollbar flex gap-px overflow-x-auto border border-line bg-line lg:flex-col lg:border-0 lg:bg-transparent" aria-label="Creation stages">
        {STAGES.map((s, i) => (
          <li key={s.key} className="min-w-[110px] flex-1 lg:min-w-0 lg:flex-none"><button type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined} className={`flex h-full w-full flex-col items-start gap-0.5 px-3 py-2 text-left lg:border-l ${i === step ? "bg-panel text-fg lg:border-amber" : "bg-bg2 text-mute hover:text-fg lg:border-line lg:bg-transparent"}`}>
            <span className="font-mono text-[10px] text-dim">{String(i + 1).padStart(2, "0")}{i < step && <span className="ml-1 text-ok">✓</span>}</span><span className="font-mono text-[11px] tracking-wider">{s.key}</span><span className="hidden text-xs text-dim lg:block">{s.hint}</span>
          </button></li>
        ))}
      </ol>

      <form className="panel min-w-0 p-5 md:p-7" onSubmit={(e) => { e.preventDefault(); if (step < 6) go(step + 1); else submit(); }}>
        <div className="t-caption">STAGE {step + 1} / 7</div>
        <h2 className="t-section mt-1 mb-6 !text-base">{STAGES[step].key}</h2>
        <div className="space-y-5">
          {step === 0 && <>
            <F label="Machine Name" id="name"><input id="name" className="input font-mono uppercase" value={d.name} maxLength={40} onChange={(e) => up("name", e.target.value)} placeholder="RESEARCH-SCOUT" autoFocus /></F>
            <fieldset><legend className="label mb-1.5">Machine Type</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{BUILDER_TYPES.map((t) => <Choice key={t} on={d.machineType === t} onClick={() => up("machineType", t)}>{TYPE_LABEL[t]}</Choice>)}</div></fieldset>
            <F label="Description" id="desc"><input id="desc" className="input" value={d.description} onChange={(e) => up("description", e.target.value)} placeholder="Evidence-backed briefings" /></F>
            <div className="flex items-center justify-between border border-dashed border-line px-3 py-3"><span className="label">Machine ID · generated</span><span className="font-mono text-sm text-amber" aria-live="polite">{d.machineCode}</span></div>
          </>}
          {step === 1 && <>
            <F label="What should this Machine accomplish?" id="obj"><textarea id="obj" rows={6} className="input" value={d.objective} onChange={(e) => up("objective", e.target.value)} placeholder="Research a topic using real web sources and produce a concise evidence-backed briefing." autoFocus /></F>
            <F label="Success Criteria" id="sc"><input id="sc" className="input" value={d.successCriteria} onChange={(e) => up("successCriteria", e.target.value)} placeholder="Every key finding cites at least one accessed source." /></F>
          </>}
          {step === 2 && <>
            <fieldset><legend className="label mb-1.5">Provider</legend>
              <div className="grid gap-2 sm:grid-cols-3">{(Object.keys(PROVIDERS) as ProviderId[]).map((k) => (
                <Choice key={k} on={d.modelProvider === k} onClick={() => setD((x) => ({ ...x, modelProvider: k, modelName: MODELS.find((m) => m.provider === k)!.id }))}>
                  <span className="block">{PROVIDERS[k].label}</span><span className={`block text-[10px] ${connected(k) ? "text-ok" : "text-dim"}`}>{k === "mock" ? "SIMULATED · ALWAYS AVAILABLE" : connected(k) ? `CONNECTED · ${String(available[k as "openai"]).toUpperCase()}` : "NOT CONNECTED"}</span>
                </Choice>))}</div></fieldset>
            {!connected(d.modelProvider) && <p className="border-l-2 border-warn pl-3 text-sm text-mute">{PROVIDERS[d.modelProvider as ProviderId].label} is not connected. Runs will fall back to <span className="text-fg">Mock Runtime</span> (simulated tools) until you <Link href="/app/settings/integrations" className="underline">connect a provider</Link>.</p>}
            <fieldset><legend className="label mb-1.5">Model</legend>
              <div className="grid gap-px border border-line bg-line">{MODELS.filter((m) => m.provider === d.modelProvider && m.enabled).map((m) => (
                <button type="button" key={m.id} onClick={() => up("modelName", m.id)} aria-pressed={d.modelName === m.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left ${d.modelName === m.id ? "bg-panel2" : "bg-bg3 hover:bg-panel"}`}>
                  <span className={`h-2 w-2 border ${d.modelName === m.id ? "border-amber bg-amber" : "border-dim"}`} aria-hidden /><span className="font-mono text-sm">{m.name}</span><span className="t-caption">{m.speed.toUpperCase()} · {(m.contextTokens / 1000).toFixed(0)}K CTX</span>
                  <span className="ml-auto flex flex-wrap gap-1">{m.capabilities.map((c) => <span key={c} className="border border-line px-1 font-mono text-[9px] text-mute">{CAPABILITY_LABEL[c]}</span>)}</span>
                  <span className="w-full font-mono text-[10px] text-dim">{m.inputPer1M !== null ? `$${m.inputPer1M} in / $${m.outputPer1M} out per 1M tokens${m.provider === "mock" ? " · simulated" : ""}` : "pricing not configured"}</span>
                </button>))}</div></fieldset>
            <F label="System Instructions" id="sys"><textarea id="sys" rows={4} className="input font-mono text-xs" value={d.systemPrompt} onChange={(e) => up("systemPrompt", e.target.value)} placeholder="Operator instructions. Platform safety rules always take precedence." /></F>
            {model?.reasoningEffort && <F label="Reasoning effort" id="eff"><div className="grid grid-cols-3 gap-2" id="eff">{(["low", "medium", "high"] as const).map((r) => <Choice key={r} on={d.reasoning === r} onClick={() => up("reasoning", r)}>{r.toUpperCase()}<span className="block text-[10px] text-dim">{r === "low" ? "faster, cheaper" : r === "medium" ? "balanced" : "most thorough"}</span></Choice>)}</div></F>}
            <fieldset><legend className="label mb-1.5">Output Format</legend><div className="grid grid-cols-2 gap-2"><Choice on={d.outputMode === "text"} onClick={() => up("outputMode", "text")}>NATURAL LANGUAGE<span className="block text-[10px] text-dim">Markdown briefing with sources</span></Choice><Choice on={d.outputMode === "structured"} onClick={() => { up("outputMode", "structured"); if (!fields.length) setFields([{ key: "company", type: "string" }, { key: "website", type: "url" }, { key: "reason", type: "string" }, { key: "confidence", type: "number" }]); }}>STRUCTURED DATA<span className="block text-[10px] text-dim">Validated JSON fields</span></Choice></div></fieldset>
            {d.outputMode === "structured" && (
              <div className="space-y-2 border border-line p-3">
                <div className="grid grid-cols-2 gap-2"><F label="Schema name" id="sn"><input id="sn" className="input h-9 text-sm" value={d.outputSchema?.name ?? ""} onChange={(e) => up("outputSchema", { ...(d.outputSchema ?? { list: false, fields }), name: e.target.value })} placeholder="Opportunity" /></F>
                  <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={d.outputSchema?.list ?? false} onChange={(e) => up("outputSchema", { ...(d.outputSchema ?? { name: "Result", fields }), list: e.target.checked })} className="accent-[#d9c9a8]" />Return a list of items</label></div>
                {fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-[1fr_110px_auto] gap-2">
                    <input aria-label={`Field ${i + 1} key`} className="input h-9 font-mono text-xs" value={f.key} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") } : x)))} />
                    <select aria-label={`Field ${i + 1} type`} className="input h-9 text-xs" value={f.type} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, type: e.target.value as OutputField["type"] } : x)))}>{["string", "number", "boolean", "url"].map((t) => <option key={t}>{t}</option>)}</select>
                    <button type="button" className="btn h-9 px-2" aria-label="Remove field" onClick={() => setFields(fields.filter((_, j) => j !== i))}>✕</button>
                  </div>))}
                <button type="button" className="btn h-8" onClick={() => setFields([...fields, { key: `field_${fields.length + 1}`, type: "string" }])} disabled={fields.length >= 20}>+ Field</button>
              </div>)}
            <div className="grid grid-cols-3 gap-3">
              <Num id="rt" label="Max runtime (s)" v={d.maxRuntimeSec} on={(v) => up("maxRuntimeSec", v)} min={10} max={900} />
              <Num id="tc" label="Max tool calls" v={d.maxToolCalls} on={(v) => up("maxToolCalls", v)} min={0} max={50} />
              <Num id="tu" label="Max AI turns" v={d.maxTurns} on={(v) => up("maxTurns", v)} min={1} max={30} />
            </div>
            <p className="t-caption">Typical research task: 4–8 turns, 5–10 tool calls. The run stops cleanly when any limit is reached.</p>
          </>}
          {step === 3 && <div className="space-y-5">
            {CATS.map((c) => (
              <fieldset key={c}><legend className="label mb-1.5">{c}</legend>
                <div className="divide-y divide-line border border-line">{TOOL_CATALOG.filter((t) => t.category === c).map((t) => {
                  const st = tool(t.id); const sandbox = t.status === "sandbox_required"; const mode = t.permission ? d.permissions[t.permission] : null;
                  return (
                    <div key={t.id} className={`p-3 ${sandbox ? "opacity-60" : ""}`}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm">{t.name}<span className="font-mono text-[9px] text-dim">{t.level}</span>{sandbox ? <span className="font-mono text-[9px] text-warn">SANDBOX REQUIRED</span> : t.permission ? <span className={`font-mono text-[9px] ${mode === "ALLOW" ? "text-ok" : mode === "ASK" ? "text-warn" : "text-bad"}`}>{t.permission} · {mode}</span> : <span className="font-mono text-[9px] text-ok">NO PERMISSION NEEDED</span>}</div><div className="t-secondary">{t.description}</div></div>
                        <Toggle on={!!st?.enabled && !sandbox} disabled={sandbox} label={t.name} onChange={(v) => setTool(t.id, { enabled: v })} />
                      </div>
                      {t.id === "http_request" && st?.enabled && <F label="Allowed domains (comma separated) — POST requires approval without a list" id="ad"><input id="ad" className="input mt-1 h-9 font-mono text-xs" value={(st.config?.allowedDomains ?? []).join(", ")} onChange={(e) => setTool(t.id, { config: { allowedDomains: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} placeholder="api.example.com, httpbin.org" /></F>}
                    </div>);
                })}
                {c === "DEVELOPER" && available.customApis.map((a) => { const st = tool(`api__${a.slug}`); return (
                  <div key={a.slug} className="flex items-start gap-3 p-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sm">{a.name}<span className="font-mono text-[9px] text-dim">CUSTOM API · {a.actions} ACTIONS</span></div><div className="t-secondary">Credentials are injected server-side; the Machine never sees them.</div></div><Toggle on={!!st?.enabled} label={a.name} onChange={(v) => setTool(`api__${a.slug}`, { enabled: v })} /></div>); })}
                </div>
                {c === "DEVELOPER" && !available.customApis.length && <p className="t-caption mt-1">Add Custom APIs in <Link href="/app/settings/integrations" className="underline">Settings → Integrations</Link>.</p>}
              </fieldset>))}
            {!enabledTools.length && <p className="border border-dashed border-line p-3 text-sm text-mute"><span className="text-fg">NO TOOLS ENABLED</span> — this Machine can reason but cannot interact with external systems.</p>}
          </div>}
          {step === 4 && <div className="grid gap-2 sm:grid-cols-2">{MEMORY_MODES.map((mm) => (
            <button key={mm.key} type="button" onClick={() => { up("memoryMode", mm.key); if ((mm.key === "persistent" || mm.key === "structured") && !tool("remember")?.enabled) setTool("remember", { enabled: true }); }} aria-pressed={d.memoryMode === mm.key} className={`border p-4 text-left ${d.memoryMode === mm.key ? "border-amber bg-panel" : "border-line hover:border-mute"}`}><div className="font-mono text-sm tracking-wider">{mm.label.toUpperCase()}</div><div className="t-secondary mt-1">{mm.desc}</div></button>))}
            <p className="t-caption sm:col-span-2">Persistent memories are curated facts proposed via the Memory Write tool and gated by the memory_write permission. Up to 5 relevant memories are loaded per run.</p>
          </div>}
          {step === 5 && <>
            <div className="grid grid-cols-3 gap-3">
              <Num id="db" label="Daily budget ($)" v={d.dailyBudget} on={(v) => up("dailyBudget", v)} min={0} step={0.5} />
              <Num id="mb" label="Monthly budget ($)" v={d.monthlyBudget} on={(v) => up("monthlyBudget", v)} min={0} />
              <Num id="mt" label="Max task cost ($)" v={d.maxTaskCost} on={(v) => up("maxTaskCost", v)} min={0.01} step={0.01} />
            </div>
            <fieldset><legend className="label mb-1.5">Permissions</legend>
              <div className="divide-y divide-line border border-line">{PERMISSIONS.map((p) => (
                <div key={p.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><div className="text-sm">{p.label} <span className={`ml-1 font-mono text-[9px] ${p.risk === "low" ? "text-ok" : p.risk === "medium" ? "text-warn" : "text-bad"}`}>{p.risk.toUpperCase()}</span></div><div className="t-secondary">{p.desc}</div></div>
                  <div className="flex" role="radiogroup" aria-label={p.label}>{(["DENY", "ASK", "ALLOW"] as PermissionMode[]).map((mo) => <button type="button" role="radio" aria-checked={d.permissions[p.key] === mo} key={mo} onClick={() => up("permissions", { ...d.permissions, [p.key]: mo })} className={`h-8 w-16 border font-mono text-[10px] ${d.permissions[p.key] === mo ? (mo === "ALLOW" ? "border-ok text-ok" : mo === "ASK" ? "border-warn text-warn" : "border-bad text-bad") : "border-line text-dim"}`}>{mo}</button>)}</div>
                </div>))}</div></fieldset>
          </>}
          {step === 6 && <dl className="grid gap-px bg-line text-sm sm:grid-cols-2">
            {[["Name", d.name.toUpperCase()], ["Machine ID", d.machineCode], ["Type", TYPE_LABEL[d.machineType]], ["Model", `${PROVIDERS[d.modelProvider as ProviderId].label} · ${model?.name}${connected(d.modelProvider) ? "" : " (falls back to Mock Runtime)"}`], ["Objective", d.objective], ["Output", d.outputMode === "structured" ? `Structured · ${fields.map((f) => f.key).join(", ")}` : "Natural language"], ["Tools", enabledTools.map((t) => t.id).join(", ") || "none"], ["Memory", d.memoryMode], ["Limits", `${d.maxRuntimeSec}s · ${d.maxToolCalls} tool calls · ${d.maxTurns} turns`], ["Budget", `$${d.dailyBudget}/day · $${d.monthlyBudget}/mo · $${d.maxTaskCost}/task`], ["ALLOW", PERMISSIONS.filter((p) => d.permissions[p.key] === "ALLOW").map((p) => p.key).join(", ") || "none"], ["ASK", PERMISSIONS.filter((p) => d.permissions[p.key] === "ASK").map((p) => p.key).join(", ") || "none"]].map(([k, v]) => (
              <div key={k} className="bg-bg3 p-3"><dt className="label">{k}</dt><dd className="mt-1 break-words font-mono text-xs">{v}</dd></div>))}
          </dl>}
        </div>
        {err && <p role="alert" className="mt-5 border border-bad/40 bg-bad/5 px-3 py-2 font-mono text-xs text-bad">{err}</p>}
        <div className="mt-8 flex justify-between gap-2 border-t border-line pt-5">
          <button type="button" className="btn" disabled={step === 0} onClick={() => go(step - 1)}>← Back</button>
          {step < 6 ? <button type="submit" className="btn btn-primary">Continue →</button> : <button type="submit" className="btn btn-primary h-11 px-6">Deploy Machine</button>}
        </div>
      </form>

      <aside className="panel hidden h-fit p-5 lg:block" aria-label="Machine preview">
        <div className="label">PREVIEW</div>
        <div className="mt-4 flex items-center gap-3"><Glyph code={d.machineCode} size={44} /><div className="min-w-0"><div className="truncate font-mono">{d.name.toUpperCase() || "UNNAMED"}</div><div className="t-caption">{d.machineCode}</div></div></div>
        <p className="t-secondary mt-4 line-clamp-4">{d.objective || "No objective defined yet."}</p>
        <dl className="mt-4 space-y-1.5 border-t border-line pt-4 font-mono text-[11px]">
          {[["RUNTIME", connected(d.modelProvider) ? `${d.modelProvider}/${d.modelName}` : "mock-runtime"], ["TOOLS", String(enabledTools.length)], ["MEMORY", d.memoryMode], ["OUTPUT", d.outputMode], ["BUDGET", `$${d.dailyBudget}/day`], ["ASK", String(PERMISSIONS.filter((p) => d.permissions[p.key] === "ASK").length)]].map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-dim">{k}</dt><dd className="truncate">{v}</dd></div>)}
        </dl>
      </aside>
    </div>
  );
}

function F({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <div><label htmlFor={id} className="label mb-1.5 block">{label}</label>{children}</div>; }
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} aria-pressed={on} className={`min-h-11 border px-3 py-2 text-left font-mono text-xs transition-colors ${on ? "border-amber bg-panel text-fg" : "border-line text-mute hover:border-mute"}`}>{children}</button>; }
function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 border transition-colors disabled:cursor-not-allowed ${on ? "border-ok bg-ok/15" : "border-line"}`}><span className={`absolute top-[3px] h-4 w-4 ${on ? "left-[22px] bg-ok" : "left-[3px] bg-dim"}`} /></button>;
}
function Num({ id, label, v, on, min, max, step = 1 }: { id: string; label: string; v: number; on: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <F label={label} id={id}><input id={id} type="number" min={min} max={max} step={step} className="input font-mono" value={v} onChange={(e) => on(Math.max(min ?? 0, Math.min(max ?? Infinity, Number(e.target.value))))} /></F>;
}
