import Link from "next/link";
import { Glyph, Status } from "@/components/ui";
import { DEMO_MACHINES, ago, hhmmss } from "@/lib/domain";
import { fmtDuration, fmtUsd } from "@/lib/utils/format";

type M = { id: string; name: string; machineCode: string; description: string; status: string; currentTask: string | null; successRate: number; tasksCompleted: number; totalCost: number; lastActiveAt: Date | null };
type A = { id: string; createdAt: Date; actor: string; message: string; category: string; severity: string };

export function ActiveMachines({ machines }: { machines: M[] }) {
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <thead><tr className="border-b border-line text-left">{["Machine", "Purpose", "Status", "Current Task", "Success", "Cost", "Last Active"].map((h) => <th key={h} scope="col" className="label px-4 py-2 font-normal">{h}</th>)}</tr></thead>
        <tbody>{machines.map((m) => (
          <tr key={m.id} className="group relative border-b border-line/60 last:border-0 hover:bg-panel">
            <td className="px-4 py-3"><Link href={`/app/machines/${m.id}`} className="flex items-center gap-3 after:absolute after:inset-0"><Glyph code={m.machineCode} size={26} active={m.status === "running"} /><span><span className="block font-mono">{m.name}</span><span className="t-caption">{m.machineCode}</span></span></Link></td>
            <td className="max-w-[160px] truncate px-4 py-3 text-mute">{m.description || "—"}</td>
            <td className="px-4 py-3"><Status s={m.status} /></td>
            <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-mute">{m.currentTask ?? "—"}</td>
            <td className="px-4 py-3 font-mono tabular-nums">{m.tasksCompleted ? `${m.successRate.toFixed(1)}%` : "—"}</td>
            <td className="px-4 py-3 font-mono tabular-nums">{fmtUsd(m.totalCost)}</td>
            <td className="px-4 py-3 font-mono text-xs text-mute">{m.status === "running" ? "NOW" : ago(m.lastActiveAt)}</td>
          </tr>))}</tbody>
      </table>
      <ul className="divide-y divide-line/60 md:hidden">{machines.map((m) => (
        <li key={m.id}><Link href={`/app/machines/${m.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-panel">
          <Glyph code={m.machineCode} size={32} active={m.status === "running"} />
          <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="font-mono">{m.name}</span><Status s={m.status} /></div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-mute">{m.currentTask ?? m.description ?? "—"}</div>
            <div className="t-caption mt-0.5">{m.tasksCompleted ? `${m.successRate.toFixed(1)}%` : "—"} · {fmtUsd(m.totalCost)} · {ago(m.lastActiveAt)}</div></div>
        </Link></li>))}</ul>
    </>
  );
}

const sevDot: Record<string, string> = { success: "bg-ok", warning: "bg-warn", critical: "bg-bad", info: "bg-dim" };
export function ActivityFeed({ items }: { items: A[] }) {
  if (!items.length) return <p className="t-secondary p-6">Events will stream here as your Machines operate.</p>;
  return (
    <ol className="max-h-[440px] divide-y divide-line/60 overflow-y-auto">{items.map((a, i) => (
      <li key={a.id} className={`grid grid-cols-[58px_8px_1fr] items-start gap-x-3 px-4 py-2.5 ${i === 0 ? "flash-in" : ""}`}>
        <time className="font-mono text-[11px] text-dim tabular-nums" dateTime={a.createdAt.toISOString()}>{hhmmss(a.createdAt)}</time>
        <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 ${sevDot[a.severity] ?? "bg-dim"}`} />
        <div className="min-w-0"><p className="text-sm">{a.message}</p><p className="t-caption mt-0.5">{a.actor} · {a.category.toUpperCase()}</p></div>
      </li>))}</ol>
  );
}

export function NetworkPanel() {
  return (
    <section className="border border-dashed border-line" aria-labelledby="net-h">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-line px-4 py-3">
        <h2 id="net-h" className="t-section">MACHINARC NETWORK</h2><span className="t-caption">PLATFORM DEMO DATA · NOT IN YOUR WORKSPACE</span>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">{[["Machines Online", "12,841"], ["Tasks Completed", "4.28M"], ["Transactions", "381K"], ["Active Arcs", "8,942"]].map(([k, v]) => (
        <div key={k} className="bg-bg p-3"><dt className="label !text-[9.5px]">{k}</dt><dd className="mt-1 font-mono text-lg tabular-nums text-mute">{v}</dd></div>))}</dl>
      <ul className="divide-y divide-line/60">{DEMO_MACHINES.map((d) => (
        <li key={d.code} className="flex items-center gap-3 px-4 py-2.5">
          <Glyph code={d.id} size={24} />
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-sm">{d.code}</span><span className="border border-line px-1 font-mono text-[9px] tracking-widest text-dim">DEMO MACHINE</span></div><div className="truncate text-xs text-mute">{d.purpose}{d.task ? ` · ${d.task}` : ""}</div></div>
          <div className="hidden text-right font-mono text-[11px] text-mute sm:block">{d.success}% · {d.tasks.toLocaleString()}</div>
          <Status s={d.status} />
        </li>))}</ul>
    </section>
  );
}

const RUN_STATUS: Record<string, string> = { queued: "queued", running: "running", waiting_approval: "pending", waiting_delay: "paused", completed: "completed", failed: "failed", cancelled: "offline" };
type R = { id: string; code: string; arcId: string; arcName: string; status: string; machines: number; durationMs: number; cost: number; createdAt: string };
export function RecentArcRuns({ runs }: { runs: R[] }) {
  return (
    <ul className="divide-y divide-line/60">
      <li className="hidden grid-cols-[minmax(0,1.4fr)_100px_150px_70px_70px_70px_80px] gap-3 px-4 py-2 md:grid">{["Arc", "Run", "Status", "Machines", "Duration", "Cost", "Started"].map((h) => <span key={h} className="label">{h}</span>)}</li>
      {runs.map((r) => (
        <li key={r.id}><Link href={`/app/arcs/${r.arcId}/runs/${r.id}`} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 hover:bg-panel md:grid-cols-[minmax(0,1.4fr)_100px_150px_70px_70px_70px_80px] md:items-center">
          <span className="truncate font-mono text-sm">{r.arcName}</span>
          <span className="font-mono text-[11px] text-mute md:order-none">{r.code}</span>
          <span className="md:order-none"><Status s={RUN_STATUS[r.status] ?? "idle"} />{r.status === "waiting_approval" && <span className="ml-1 font-mono text-[9px] text-warn">APPROVAL</span>}</span>
          <span className="hidden font-mono text-xs md:block">{r.machines}</span>
          <span className="justify-self-end font-mono text-[11px] text-mute md:justify-self-start">{r.durationMs ? fmtDuration(r.durationMs) : "—"}</span>
          <span className="hidden font-mono text-[11px] md:block">{fmtUsd(r.cost)}</span>
          <span className="hidden font-mono text-[11px] text-mute md:block">{ago(r.createdAt)}</span>
        </Link></li>
      ))}
    </ul>
  );
}
