"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Empty, Glyph, Status } from "@/components/ui";
import { TYPE_LABEL, ago } from "@/lib/domain";
import { fmtUsd } from "@/lib/utils/format";

export type MachineRow = { id: string; name: string; machineCode: string; description: string; objective: string; machineType: string; status: string; currentTask: string | null; tasksCompleted: number; successRate: number; totalCost: number; modelName: string; lastActiveAt: string | null };
const FILTERS = ["all", "running", "idle", "paused", "failed"];

export function MachineList({ rows, initial }: { rows: MachineRow[]; initial: { status: string; q: string; view: "grid" | "list" } }) {
  const router = useRouter();
  const path = usePathname();
  const [f, setFState] = useState(initial.status);
  const [q, setQState] = useState(initial.q);
  const [view, setViewState] = useState<"grid" | "list">(initial.view);
  const sync = (n: { status?: string; q?: string; view?: string }) => {
    const p = new URLSearchParams();
    const st = n.status ?? f, qq = n.q ?? q, v = n.view ?? view;
    if (st !== "all") p.set("status", st);
    if (qq) p.set("q", qq);
    if (v !== "grid") p.set("view", v);
    router.replace(`${path}${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  const setF = (x: string) => { setFState(x); sync({ status: x }); };
  const setQ = (x: string) => { setQState(x); sync({ q: x }); };
  const setView = (x: "grid" | "list") => { setViewState(x); sync({ view: x }); };
  const list = useMemo(() => rows.filter((r) => (f === "all" || r.status === f) && `${r.name} ${r.machineCode} ${r.description} ${r.objective}`.toLowerCase().includes(q.toLowerCase())), [rows, f, q]);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="no-scrollbar flex overflow-x-auto border border-line" role="tablist">
          {FILTERS.map((x) => (
            <button key={x} role="tab" aria-selected={f === x} onClick={() => setF(x)} className={`px-4 py-2 font-mono text-[11px] tracking-widest ${f === x ? "bg-fg text-bg" : "text-mute hover:text-fg"}`}>
              {x.toUpperCase()} <span className="opacity-60">{x === "all" ? rows.length : rows.filter((r) => r.status === x).length}</span>
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Machines, IDs, objectives…" className="input h-10 md:ml-auto md:max-w-xs" type="search" aria-label="Search Machines" />
        <div className="flex border border-line">
          {(["grid", "list"] as const).map((v) => <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-3 py-2 font-mono text-[11px] ${view === v ? "bg-panel2 text-fg" : "text-mute"}`}>{v.toUpperCase()}</button>)}
        </div>
      </div>
      {list.length === 0 ? (
        rows.length === 0 ? <Empty title="NO MACHINES DEPLOYED" body="Your workspace does not contain any Machines yet. Create one to begin operating on MachinArc." href="/app/machines/new" cta="Create Machine" />
          : <Empty title="NO MATCHING MACHINES" body="No Machines match this filter. Adjust the status or search query." />
      ) : view === "grid" ? (
        <div className="stagger grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <Link key={m.id} href={`/app/machines/${m.id}`} className="card-hover group flex flex-col bg-bg3 p-4 hover:bg-panel">
              <div className="flex items-start gap-3">
                <Glyph code={m.machineCode} size={40} active={m.status === "running"} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-base tracking-wider">{m.name}</div>
                  <div className="font-mono text-[11px] text-dim">{m.machineCode}</div>
                </div>
                <Status s={m.status} />
              </div>
              <div className="label mt-4">{TYPE_LABEL[m.machineType] ?? "Custom"}{m.description ? ` · ${m.description}` : ""}</div>
              <p className="mt-1 line-clamp-2 text-sm text-mute">{m.objective}</p>
              <div className="mt-3 truncate border-l border-line pl-3 font-mono text-xs text-fg/80">{m.status === "running" && m.currentTask ? `▸ ${m.currentTask}` : m.status === "initializing" ? "Initializing runtime…" : `Last active ${ago(m.lastActiveAt)}`}</div>
              <div className="mt-5 grid grid-cols-4 gap-2 border-t border-line pt-4">
                {[["SUCCESS", `${m.successRate.toFixed(1)}%`], ["TASKS", m.tasksCompleted.toLocaleString()], ["COST", fmtUsd(m.totalCost)], ["MODEL", m.modelName === "mock-runtime" ? "mock" : m.modelName]].map(([l, v]) => (
                  <div key={l}><div className="label !text-[9.5px]">{l}</div><div className="mt-1 truncate font-mono text-xs tabular-nums">{v}</div></div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-line text-left">{["Machine", "Purpose", "Status", "Tasks", "Success", "Cost", "Model", "Last"].map((h) => <th key={h} className="label px-4 py-2 font-normal">{h}</th>)}</tr></thead>
            <tbody>{list.map((m) => (
              <tr key={m.id} className="border-b border-line/60 hover:bg-panel">
                <td className="px-4 py-3"><Link href={`/app/machines/${m.id}`} className="font-mono">{m.name}<span className="ml-2 text-[11px] text-dim">{m.machineCode}</span></Link></td>
                <td className="px-4 py-3 text-mute">{m.description}</td><td className="px-4 py-3"><Status s={m.status} /></td>
                <td className="px-4 py-3 font-mono">{m.tasksCompleted.toLocaleString()}</td><td className="px-4 py-3 font-mono">{m.successRate.toFixed(1)}%</td>
                <td className="px-4 py-3 font-mono">{fmtUsd(m.totalCost)}</td><td className="px-4 py-3 font-mono text-mute">{m.modelName}</td><td className="px-4 py-3 font-mono text-xs text-mute">{ago(m.lastActiveAt)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
