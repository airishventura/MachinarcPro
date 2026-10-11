"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { hireAction } from "@/app/actions";
import { Glyph, Status } from "@/components/ui";
import { NETWORK_MACHINES } from "@/lib/domain";

const CATS = ["All", "Research", "Development", "Finance", "Monitoring", "Creative", "Operations", "Data"];
type NM = (typeof NETWORK_MACHINES)[number];

export function NetworkMarket({ mine }: { mine: { id: string; name: string }[] }) {
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [hiring, setHiring] = useState<NM | null>(null);
  const list = useMemo(() => NETWORK_MACHINES.filter((m) => (cat === "All" || m.category === cat) && `${m.code} ${m.capability} ${m.owner}`.toLowerCase().includes(q.toLowerCase())), [cat, q]);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="no-scrollbar flex overflow-x-auto border border-line">{CATS.map((c) => <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c} className={`px-3 py-2 font-mono text-[11px] tracking-widest ${cat === c ? "bg-fg text-bg" : "text-mute hover:text-fg"}`}>{c.toUpperCase()}</button>)}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search capabilities…" aria-label="Search network" className="input md:ml-auto md:max-w-xs" />
      </div>
      {list.length === 0 ? <div className="border border-dashed border-line p-12 text-center font-mono text-xs text-mute">NO MACHINES DISCOVERED IN THIS SECTOR</div> : (
        <div className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <div key={m.code} className="flex flex-col bg-bg3 p-5">
              <div className="flex items-start gap-3"><Glyph code={m.code} size={40} active={m.status === "AVAILABLE"} /><div className="flex-1"><div className="font-mono tracking-wider">{m.code}</div><div className="text-sm text-mute">{m.capability}</div></div><Status s={m.status} /></div>
              <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
                {[["REPUTATION", m.reputation.toFixed(1)], ["TASKS", m.tasks.toLocaleString()], ["COST", `${m.price.toFixed(2)}/task`], ["RESPONSE", m.response]].map(([l, v]) => <div key={l}><div className="label !text-[9.5px]">{l}</div><div className="mt-1 font-mono text-xs">{v}</div></div>)}
              </div>
              <div className="mt-4 flex items-center justify-between"><span className="font-mono text-[11px] text-dim">by {m.owner}</span>
                <button disabled={m.status === "OFFLINE"} onClick={() => setHiring(m)} className="btn btn-primary h-8">Simulate Hire</button></div>
            </div>
          ))}
        </div>
      )}
      {hiring && <HireDialog target={hiring} mine={mine} onClose={() => setHiring(null)} />}
    </div>
  );
}

function HireDialog({ target, mine, onClose }: { target: NM; mine: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [from, setFrom] = useState(mine[0]?.id ?? "");
  const [purpose, setPurpose] = useState(`Analyze these 12 companies`);
  const [phase, setPhase] = useState(-1);
  const [result, setResult] = useState<string>("");
  const fromName = mine.find((m) => m.id === from)?.name ?? "";
  const steps = ["Checking your Machine's permissions…"];

  async function go() {
    setPhase(0);
    try {
      const r = await hireAction(from, target.code, purpose);
      setResult(r.status);
    } catch {
      setResult("error");
    }
    setPhase(steps.length);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal aria-labelledby="hire-title">
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="fade-up relative w-full max-w-lg border border-line bg-bg3 p-6">
        <div id="hire-title" className="font-mono text-sm tracking-[.18em]">SIMULATED MACHINE HIRE</div>
        <p className="mt-1 text-sm text-mute">Check permissions for an example hire of {target.code}. No task executes, result is generated, or Credits are charged.</p>
        {mine.length === 0 ? <p className="mt-6 text-sm text-warn">Deploy a Machine first — only Machines can hire Machines.</p> : phase < 0 ? (
          <div className="mt-6 space-y-4">
            <label className="block"><span className="label">Hiring Machine</span><select className="input mt-1 font-mono" value={from} onChange={(e) => setFrom(e.target.value)}>{mine.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label className="block"><span className="label">Task</span><input className="input mt-1" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label>
            <div className="flex justify-between border border-line p-3 font-mono text-xs"><span className="text-mute">EXAMPLE PRICE</span><span>{target.price.toFixed(2)} Credits · no charge</span></div>
          </div>
        ) : (
          <div className="mt-6">
            <div className="flex items-center justify-between font-mono text-xs">
              <span className="border border-line px-2 py-1">{fromName}</span>
              <div className="relative mx-3 h-px flex-1 bg-line">{phase < steps.length && <span className="sweep absolute -top-[2px] h-[5px] w-6 bg-amber" />}</div>
              <span className="border border-line px-2 py-1">{target.code}</span>
            </div>
            <ul className="mt-5 space-y-1.5 font-mono text-xs" aria-live="polite">
              {steps.map((s, i) => <li key={i} className={i < phase ? "text-mute" : i === phase ? "text-fg" : "text-dim"}>{i < phase ? "✓" : i === phase ? "▸" : "·"} {s}</li>)}
            </ul>
            {phase === steps.length && (
              <div className={`fade-up mt-5 border p-3 font-mono text-xs ${result === "simulated" ? "border-ok/40 text-ok" : result === "approval" ? "border-warn/40 text-warn" : "border-bad/40 text-bad"}`}>
                {result === "simulated" ? "SIMULATION COMPLETE — no task executed or Credits charged." : result === "approval" ? "SIMULATION REQUIRES AUTHORIZATION — review it in the Command Center." : result === "denied" ? "DENIED BY PERMISSION BOUNDARY — review machine_call / financial_action." : "SIMULATION FAILED — close this dialog and try again."}
              </div>
            )}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn">{phase === steps.length ? "Close" : "Cancel"}</button>
          {phase < 0 && mine.length > 0 && <button onClick={go} className="btn btn-primary">Check Permissions</button>}
        </div>
      </div>
    </div>
  );
}
