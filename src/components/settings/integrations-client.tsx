"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureSearchAction, connectProviderAction, disconnectIntegrationAction, saveCustomApiAction } from "@/app/runtime-actions";
import type { CustomApiConfig } from "@/lib/tools/registry";

const STATUS: Record<string, { t: string; c: string }> = {
  connected: { t: "CONNECTED", c: "text-ok border-ok/40" }, not_connected: { t: "NOT CONNECTED", c: "text-dim border-line" },
  configuration_required: { t: "CONFIGURATION REQUIRED", c: "text-warn border-warn/40" }, error: { t: "ERROR", c: "text-bad border-bad/40" }, auth_error: { t: "AUTHENTICATION ERROR", c: "text-bad border-bad/40" },
  sandbox_required: { t: "SANDBOX REQUIRED", c: "text-warn border-warn/40" }, builtin: { t: "BUILT-IN", c: "text-ok border-ok/40" },
};
export function StatusBadge({ s }: { s: string }) { const x = STATUS[s] ?? STATUS.not_connected; return <span className={`border px-1.5 py-0.5 font-mono text-[10px] tracking-widest ${x.c}`}>{x.t}</span>; }

export function ProviderCard({ id, name, status, mode, hint, lastSuccess, lastError, docs }: { id: "openai" | "anthropic"; name: string; status: string; mode: string | null; hint: string | null; lastSuccess: string | null; lastError: string | null; docs: string }) {
  const r = useRouter();
  const [open, setOpen] = useState(false); const [key, setKey] = useState(""); const [err, setErr] = useState(""); const [pending, start] = useTransition();
  return (
    <div className="flex flex-col bg-bg3 p-4">
      <div className="flex items-start justify-between gap-2"><div><div className="font-mono tracking-wider">{name.toUpperCase()}</div><div className="t-caption mt-0.5">{mode === "workspace" ? `WORKSPACE KEY ${hint ?? ""}` : mode === "platform" ? "PLATFORM MANAGED" : "NO CREDENTIALS"}</div></div><StatusBadge s={status} /></div>
      <dl className="mt-3 space-y-1 font-mono text-[11px]"><div className="flex justify-between"><dt className="text-dim">LAST SUCCESS</dt><dd>{lastSuccess ?? "—"}</dd></div>{lastError && <div className="text-bad">{lastError}</div>}</dl>
      {open ? (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const x = await connectProviderAction(id, key); if (!x.ok) setErr(x.error); else { setKey(""); setOpen(false); setErr(""); r.refresh(); } }); }}>
          <label htmlFor={`k-${id}`} className="label">API key · encrypted at rest, never shown again</label>
          <input id={`k-${id}`} type="password" autoComplete="off" className="input font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} placeholder={id === "openai" ? "sk-…" : "sk-ant-…"} autoFocus />
          {err && <p role="alert" className="font-mono text-[11px] text-bad">{err}</p>}
          <div className="flex gap-2"><button type="button" className="btn h-8" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary h-8" disabled={pending || key.length < 20}>{pending ? "Verifying…" : "Verify & Connect"}</button></div>
          <a href={docs} target="_blank" rel="noopener noreferrer" className="t-caption underline">Get a key ↗</a>
        </form>
      ) : (
        <div className="mt-auto flex gap-2 pt-4">
          <button className="btn h-8" onClick={() => setOpen(true)}>{status === "auth_error" ? "Update Credentials" : mode === "workspace" ? "Replace Key" : "Connect"}</button>
          {mode === "workspace" && <button className="btn btn-danger h-8" disabled={pending} onClick={() => { if (confirm(`Disconnect ${name}?`)) start(async () => { await disconnectIntegrationAction(id); r.refresh(); }); }}>Disconnect</button>}
        </div>
      )}
    </div>
  );
}

export function SearchCard({ provider, hasKey }: { provider: string; hasKey: boolean }) {
  const r = useRouter(); const [p, setP] = useState(provider); const [key, setKey] = useState(""); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [pending, start] = useTransition();
  return (
    <form className="flex flex-col bg-bg3 p-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const x = await configureSearchAction(p as "bing_rss", key || undefined); if (!x.ok) setErr(x.error); else { setErr(""); setKey(""); setMsg("SAVED"); r.refresh(); } }); }}>
      <div className="flex items-start justify-between"><div><div className="font-mono tracking-wider">WEB SEARCH</div><div className="t-caption mt-0.5">SEARCH PROVIDER</div></div><StatusBadge s="connected" /></div>
      <fieldset className="mt-3 space-y-1.5 text-sm"><legend className="sr-only">Search provider</legend>{[["bing_rss", "Bing (keyless RSS)", "Works without credentials. Basic results."], ["tavily", "Tavily", "Research-grade results. API key required."], ["brave", "Brave Search", "Independent index. API key required."]].map(([k, l, d]) => (
        <label key={k} className={`flex cursor-pointer items-start gap-2 border px-2 py-1.5 ${p === k ? "border-amber" : "border-line"}`}><input type="radio" name="sp" value={k} checked={p === k} onChange={() => setP(k)} className="mt-1 accent-[#d9c9a8]" /><span><span className="block font-mono text-xs">{l}{k === provider && hasKey && k !== "bing_rss" ? " · key stored" : ""}</span><span className="t-caption">{d}</span></span></label>))}</fieldset>
      {p !== "bing_rss" && <input type="password" autoComplete="off" aria-label="Search API key" className="input mt-2 font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey && p === provider ? "Leave blank to keep stored key" : "API key"} />}
      {err && <p role="alert" className="mt-2 font-mono text-[11px] text-bad">{err}</p>}
      <div className="mt-auto flex items-center gap-2 pt-3"><button className="btn h-8" disabled={pending || (p !== "bing_rss" && !key && !(hasKey && p === provider))}>Save</button>{msg && <span className="font-mono text-[10px] text-ok">{msg}</span>}</div>
    </form>
  );
}

type Action = CustomApiConfig["actions"][number];
const blankAction = (): Action => ({ name: "", method: "GET", path: "", description: "", params: [] });

export function CustomApiBuilder() {
  const r = useRouter();
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", description: "", baseUrl: "https://", allowedDomains: "", authType: "bearer" as CustomApiConfig["authType"], authName: "", secret: "" });
  const [actions, setActions] = useState<Action[]>([{ name: "lookup", method: "GET", path: "/customers/{{customer_id}}", description: "Look up a customer by ID", params: [{ name: "customer_id", in: "path", type: "string", required: true }] }]);
  const upA = (i: number, p: Partial<Action>) => setActions(actions.map((a, j) => (j === i ? { ...a, ...p } : a)));
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>+ Add Custom API</button>;
  return (
    <form className="space-y-4 border border-line bg-bg3 p-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const x = await saveCustomApiAction({ name: f.name, secret: f.secret, config: { description: f.description, baseUrl: f.baseUrl, allowedDomains: f.allowedDomains.split(",").map((s) => s.trim()).filter(Boolean), authType: f.authType, authName: f.authName, actions } }); if (!x.ok) setErr(x.error); else { setOpen(false); setErr(""); r.refresh(); } }); }}>
      <div className="t-section">NEW CUSTOM API</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {([["name", "Name", "CRM"], ["baseUrl", "Base URL (https)", "https://api.example.com/v1"], ["description", "Description", "Customer records"], ["allowedDomains", "Additional allowed domains", "cdn.example.com"]] as const).map(([k, l, ph]) => <div key={k}><label htmlFor={`ca-${k}`} className="label mb-1 block">{l}</label><input id={`ca-${k}`} className="input h-9 text-sm" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} /></div>)}
        <div><label htmlFor="ca-auth" className="label mb-1 block">Authentication</label><select id="ca-auth" className="input h-9 text-sm" value={f.authType} onChange={(e) => setF({ ...f, authType: e.target.value as CustomApiConfig["authType"] })}><option value="none">None</option><option value="bearer">Bearer token</option><option value="header">API key header</option><option value="query">API key query param</option></select></div>
        {f.authType !== "none" && <div><label htmlFor="ca-secret" className="label mb-1 block">Secret · encrypted, injected server-side</label><input id="ca-secret" type="password" autoComplete="off" className="input h-9 font-mono text-xs" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></div>}
        {(f.authType === "header" || f.authType === "query") && <div><label htmlFor="ca-an" className="label mb-1 block">{f.authType === "header" ? "Header name" : "Query param"}</label><input id="ca-an" className="input h-9 font-mono text-xs" value={f.authName} onChange={(e) => setF({ ...f, authName: e.target.value })} placeholder={f.authType === "header" ? "x-api-key" : "api_key"} /></div>}
      </div>
      <div className="space-y-3"><div className="label">ACTIONS · each becomes a Machine tool</div>
        {actions.map((a, i) => (
          <div key={i} className="space-y-2 border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_90px_1.4fr_auto]">
              <input aria-label="Action name" className="input h-9 font-mono text-xs" value={a.name} onChange={(e) => upA(i, { name: e.target.value })} placeholder="lookup" />
              <select aria-label="Method" className="input h-9 text-xs" value={a.method} onChange={(e) => upA(i, { method: e.target.value as "GET" | "POST" })}><option>GET</option><option>POST</option></select>
              <input aria-label="Path" className="input h-9 font-mono text-xs" value={a.path} onChange={(e) => upA(i, { path: e.target.value })} placeholder="/customers/{{customer_id}}" />
              <button type="button" className="btn h-9 px-2" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label="Remove action">✕</button>
            </div>
            <input aria-label="Action description" className="input h-9 text-xs" value={a.description} onChange={(e) => upA(i, { description: e.target.value })} placeholder="What this action does (shown to the Machine)" />
            {a.params.map((p, k) => (
              <div key={k} className="grid grid-cols-[1fr_90px_90px_auto_auto] items-center gap-2">
                <input aria-label="Param name" className="input h-8 font-mono text-xs" value={p.name} onChange={(e) => upA(i, { params: a.params.map((x, z) => (z === k ? { ...x, name: e.target.value } : x)) })} />
                <select aria-label="Param location" className="input h-8 text-xs" value={p.in} onChange={(e) => upA(i, { params: a.params.map((x, z) => (z === k ? { ...x, in: e.target.value as "path" } : x)) })}><option>path</option><option>query</option><option>body</option></select>
                <select aria-label="Param type" className="input h-8 text-xs" value={p.type} onChange={(e) => upA(i, { params: a.params.map((x, z) => (z === k ? { ...x, type: e.target.value as "string" } : x)) })}><option>string</option><option>number</option><option>boolean</option></select>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={!!p.required} onChange={(e) => upA(i, { params: a.params.map((x, z) => (z === k ? { ...x, required: e.target.checked } : x)) })} className="accent-[#d9c9a8]" />req</label>
                <button type="button" className="btn h-8 px-2" aria-label="Remove param" onClick={() => upA(i, { params: a.params.filter((_, z) => z !== k) })}>✕</button>
              </div>))}
            <button type="button" className="btn h-7 text-[10px]" onClick={() => upA(i, { params: [...a.params, { name: "", in: "query", type: "string" }] })}>+ Parameter</button>
          </div>))}
        <button type="button" className="btn h-8" onClick={() => setActions([...actions, blankAction()])}>+ Action</button>
      </div>
      {err && <p role="alert" className="font-mono text-xs text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save Custom API"}</button></div>
    </form>
  );
}

export function RemoveIntegration({ slug, name }: { slug: string; name: string }) {
  const r = useRouter(); const [pending, start] = useTransition();
  return <button className="btn btn-danger h-8" disabled={pending} onClick={() => { if (confirm(`Remove ${name}? Machines using it lose access.`)) start(async () => { await disconnectIntegrationAction(slug); r.refresh(); }); }}>Remove</button>;
}
