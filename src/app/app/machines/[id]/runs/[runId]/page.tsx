import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, machineCallRelationships, machineLogs, machineMemories, machineRuns, machines, machineTasks, runSources, runUsage, toolExecutions, users } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { toolMeta } from "@/config/tools";
import { PROVIDERS, getModel } from "@/config/models";
import { fmtDuration, fmtUsd } from "@/lib/utils/format";
import { Status } from "@/components/ui";
import { ResultView } from "@/components/machines/runtime-parts";
import { AutoRefresh } from "@/components/client-bits";

const ACTIVE = ["queued", "initializing", "running", "waiting_tool", "waiting_approval"];
const chip = (s: string) => (s === "completed" ? "completed" : s === "failed" || s === "timeout" ? "failed" : s === "cancelled" ? "offline" : s === "budget_exceeded" ? "paused" : s === "waiting_approval" ? "pending" : "running");
const LEVEL: Record<string, string> = { ERROR: "text-bad", "TOOL ERROR": "text-bad", WARNING: "text-warn", APPROVAL: "text-warn", "TOOL REQUEST": "text-proc", "TOOL RESULT": "text-ok", AI: "text-amber", PLAN: "text-fg", MEMORY: "text-ok", OUTPUT: "text-ok", "MACHINE CALL": "text-amber", "MACHINE RESULT": "text-amber" };

export default async function RunInspector({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId: raw } = await params;
  const { workspace } = await requireSession();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [m] = await db.select().from(machines).where(and(eq(machines.id, id), eq(machines.workspaceId, workspace.id)));
  if (!m) notFound();
  const byTask = raw.startsWith("task-");
  const key = byTask ? raw.slice(5) : raw;
  if (!/^[0-9a-f-]{36}$/i.test(key)) notFound();
  const [run] = await db.select().from(machineRuns).where(and(eq(machineRuns.machineId, m.id), byTask ? eq(machineRuns.taskId, key) : eq(machineRuns.id, key))).orderBy(desc(machineRuns.createdAt)).limit(1);
  if (!run) notFound();
  const [[task], logs, tools, usage, sources, approvals, calls] = await Promise.all([
    db.select().from(machineTasks).where(eq(machineTasks.id, run.taskId)),
    db.select().from(machineLogs).where(eq(machineLogs.runId, run.id)).orderBy(machineLogs.createdAt),
    db.select().from(toolExecutions).where(eq(toolExecutions.machineRunId, run.id)).orderBy(toolExecutions.createdAt),
    db.select().from(runUsage).where(eq(runUsage.machineRunId, run.id)).orderBy(runUsage.createdAt),
    db.select().from(runSources).where(eq(runSources.machineRunId, run.id)).orderBy(runSources.accessedAt),
    db.select({ a: approvalRequests, operator: users.name }).from(approvalRequests).leftJoin(users, eq(users.id, approvalRequests.decidedBy)).where(eq(approvalRequests.machineRunId, run.id)).orderBy(approvalRequests.createdAt),
    db.select({ r: machineCallRelationships, child: machines.name, childCode: machines.machineCode }).from(machineCallRelationships).innerJoin(machines, eq(machines.id, machineCallRelationships.childMachineId)).where(or(eq(machineCallRelationships.parentRunId, run.id), eq(machineCallRelationships.childRunId, run.id))),
  ]);
  const memIds = run.memoryIds ?? [];
  const [loaded, written] = await Promise.all([
    memIds.length ? db.select().from(machineMemories).where(inArray(machineMemories.id, memIds)) : Promise.resolve([]),
    db.select().from(machineMemories).where(eq(machineMemories.sourceRunId, run.id)),
  ]);
  const parentCall = calls.find((c) => c.r.childRunId === run.id);
  const childCalls = calls.filter((c) => c.r.parentRunId === run.id);
  const [parent] = parentCall ? await db.select({ name: machines.name, id: machines.id }).from(machines).where(eq(machines.id, parentCall.r.parentMachineId)) : [];
  const live = ACTIVE.includes(run.status);
  const t0 = (run.startedAt ?? run.createdAt).getTime();
  // Server component: rendered once per request, so reading the clock here is deterministic for that response.
  // eslint-disable-next-line react-hooks/purity
  const duration = run.endedAt ? run.endedAt.getTime() - t0 : live ? Date.now() - t0 : 0;
  const errors = [...(run.error ? [{ at: run.endedAt ?? run.createdAt, msg: run.error }] : []), ...tools.filter((t) => t.error && t.status !== "denied").map((t) => ({ at: t.completedAt ?? t.createdAt, msg: `${t.toolId}: ${t.error}` })), ...tools.filter((t) => t.status === "denied").map((t) => ({ at: t.createdAt, msg: `PERMISSION DENIED · ${t.toolId}: ${t.error}` }))];
  const pricing = getModel(run.provider, run.model);

  return (
    <div className="space-y-6">
      {live && <AutoRefresh ms={2500} />}
      <nav className="t-caption flex flex-wrap gap-2 tracking-widest"><Link href="/app/machines" className="hover:text-fg">MACHINES</Link><span>/</span><Link href={`/app/machines/${m.id}?task=${run.taskId}`} className="hover:text-fg">{m.name}</Link><span>/</span><span>RUN {run.id.slice(0, 8)}</span></nav>
      <header className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0"><div className="t-caption">RUN INSPECTOR · {m.machineCode}{run.depth ? ` · CHILD RUN (DEPTH ${run.depth})` : ""}</div><h1 className="t-title mt-1">TASK #{task?.number}</h1><div className="mt-2 flex flex-wrap items-center gap-3"><Status s={chip(run.status)} /><span className="font-mono text-[11px] text-mute">{run.status.replace(/_/g, " ").toUpperCase()}</span>{parent && <Link href={`/app/machines/${parent.id}/runs/${parentCall!.r.parentRunId}`} className="font-mono text-[11px] text-amber hover:underline">← CALLED BY {parent.name}</Link>}</div></div>
        <Link className="btn" href={`/app/machines/${m.id}?task=${run.taskId}`}>Open in Console</Link>
      </header>

      <section aria-labelledby="sum"><h2 id="sum" className="label mb-2">SUMMARY</h2>
        <dl className="grid grid-cols-2 gap-px border border-line bg-line font-mono text-[12px] sm:grid-cols-4 xl:grid-cols-8">
          {[["MODEL", run.provider === "mock" ? "Mock Runtime" : `${PROVIDERS[run.provider as keyof typeof PROVIDERS]?.label ?? run.provider} · ${run.model}`], ["DURATION", duration ? fmtDuration(duration) : "—"], ["TOTAL COST", `${fmtUsd(run.cost)}${run.pricingKnown ? "" : "*"}`], ["AI TURNS", String(run.turns)], ["TOOL CALLS", String(run.toolCalls)], ["TOKENS", (run.inputTokens + run.outputTokens).toLocaleString()], ["SOURCES", String(sources.length)], ["MEMORY", `${loaded.length} loaded · ${written.length} written`]].map(([k, v]) => <div key={k} className="min-w-0 bg-bg3 p-3"><dt className="text-[10px] text-dim">{k}</dt><dd className="mt-1 truncate">{v}</dd></div>)}
        </dl>
        <div className="panel mt-3 p-4"><div className="label">TASK</div><p className="mt-1 whitespace-pre-wrap break-words text-sm">{task?.input}</p></div>
      </section>

      {run.error && <section className="border border-bad/50 bg-bad/5 p-4" role="alert"><div className="t-section !text-bad">{run.status.replace(/_/g, " ").toUpperCase()}</div><p className="mt-1 text-sm">{run.error}</p>{run.errorKind?.startsWith("provider_auth") && <Link className="btn mt-3 h-8" href="/app/settings/integrations">Update Credentials</Link>}</section>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="exec"><h2 id="exec" className="label mb-2">EXECUTION TIMELINE <span className="normal-case text-dim">· operational telemetry, not model reasoning</span></h2>
          <ol className="max-h-[560px] overflow-y-auto border border-line bg-[#070707] p-3 font-mono text-[12px] leading-6">
            {logs.map((l) => <li key={l.id} className="grid grid-cols-[62px_118px_1fr] gap-2"><span className="text-dim tabular-nums">{((l.createdAt.getTime() - t0) / 1000).toFixed(1).padStart(5, "0")}</span><span className={LEVEL[l.level] ?? "text-mute"}>{l.level}</span><span className="break-words text-fg/90">{l.toolExecutionId ? <a href={`#tool-${l.toolExecutionId}`} className="hover:underline">{l.message}</a> : l.message}</span></li>)}
            {live && <li className="text-dim"><span className="caret">▍</span></li>}
          </ol>
        </section>
        <section aria-labelledby="out"><h2 id="out" className="label mb-2">OUTPUT</h2>
          {task?.result && task.status === "completed" ? <div className="panel p-4"><ResultView r={task.result} /></div> : <p className="t-secondary border border-dashed border-line p-6">{live ? "Run in progress — output appears when the Machine finishes." : "No output was produced."}</p>}
        </section>
      </div>

      <section aria-labelledby="tools"><h2 id="tools" className="label mb-2">TOOLS · {tools.length}</h2>
        {!tools.length ? <p className="t-secondary border border-dashed border-line p-4">No tool calls in this run.</p> : (
          <ul className="divide-y divide-line border border-line">{tools.map((t) => (
            <li key={t.id} id={`tool-${t.id}`}><details className="group">
              <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-panel md:grid-cols-[160px_minmax(0,1fr)_150px_110px_70px_16px] md:items-center">
                <span className="font-mono text-sm">{toolMeta(t.toolId)?.name ?? t.toolId}</span>
                <span className="order-3 col-span-2 truncate font-mono text-[11px] text-mute md:order-none md:col-span-1">{t.summary}{t.simulated ? " · SIMULATED" : ""}</span>
                <span className="justify-self-end md:justify-self-start"><Status s={t.status === "completed" ? "completed" : t.status === "denied" || t.status === "failed" ? "failed" : t.status === "waiting_approval" ? "pending" : t.status === "cancelled" ? "offline" : "running"} /></span>
                <span className="font-mono text-[10px] text-dim">{t.permission ? `${t.permission} · ${t.permissionDecision ?? "—"}` : "no permission"}</span>
                <span className="font-mono text-[11px] text-mute">{t.durationMs ? fmtDuration(t.durationMs) : "—"}</span>
                <span className="hidden text-dim group-open:rotate-45 md:block">+</span>
              </summary>
              <div className="grid gap-3 border-t border-line bg-bg2 p-4 lg:grid-cols-2">
                <div><div className="label mb-1">INPUT · redacted</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 font-mono text-[11px]">{JSON.stringify(t.inputPayload ?? {}, null, 2)}</pre></div>
                <div><div className="label mb-1">OUTPUT {t.error && <span className="text-bad">· {t.error}</span>}</div><p className="mb-1 font-mono text-[11px] text-fg/85">{t.outputPreview}</p><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 font-mono text-[11px] text-fg/80">{JSON.stringify(t.outputPayload ?? null, null, 2)?.slice(0, 20000)}</pre></div>
              </div>
            </details></li>))}</ul>)}
      </section>

      {(childCalls.length > 0 || approvals.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {childCalls.length > 0 && <section><h2 className="label mb-2">MACHINE CALLS</h2><ul className="divide-y divide-line border border-line">{childCalls.map((c) => <li key={c.r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="font-mono">{m.name} → {c.child}<span className="ml-2 text-[10px] text-dim">DEPTH {c.r.depth}</span></span><span className="flex items-center gap-3"><span className="font-mono text-[11px]">{fmtUsd(c.r.cost)}</span>{c.r.childRunId && <Link className="t-caption hover:text-fg" href={`/app/machines/${c.r.childMachineId}/runs/${c.r.childRunId}`}>VIEW RUN →</Link>}</span></li>)}</ul></section>}
          {approvals.length > 0 && <section><h2 className="label mb-2">AUTHORIZATIONS</h2><ul className="divide-y divide-line border border-line">{approvals.map(({ a, operator }) => <li key={a.id} className="px-4 py-2.5 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono">{toolMeta(a.toolId)?.name ?? a.toolId}{a.destination ? ` → ${a.destination}` : ""}</span><span className={`font-mono text-[10px] ${a.status === "approved" ? "text-ok" : a.status === "pending" ? "text-warn" : "text-bad"}`}>{a.status.toUpperCase()}{a.decision ? ` · ${a.decision.replace("_", " ").toUpperCase()}` : ""}</span></div><p className="t-caption mt-0.5">RISK {a.risk.toUpperCase()} · {a.permission}{operator ? ` · BY ${operator.toUpperCase()}` : ""}{a.decidedAt ? ` · ${a.decidedAt.toTimeString().slice(0, 8)}` : ""}</p></li>)}</ul></section>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="mem"><h2 id="mem" className="label mb-2">MEMORY</h2>
          <div className="border border-line">
            <div className="border-b border-line px-4 py-2 font-mono text-[10px] tracking-widest text-dim">LOADED INTO CONTEXT · {loaded.length}</div>
            {loaded.length ? <ul className="divide-y divide-line/60">{loaded.map((x) => <li key={x.id} className="px-4 py-2 text-sm">{x.content}<span className="ml-2 font-mono text-[10px] text-dim">IMPORTANCE {x.importance}</span></li>)}</ul> : <p className="t-secondary px-4 py-3">No memories influenced this run.</p>}
            <div className="border-y border-line px-4 py-2 font-mono text-[10px] tracking-widest text-dim">WRITTEN BY THIS RUN · {written.length}</div>
            {written.length ? <ul className="divide-y divide-line/60">{written.map((x) => <li key={x.id} className="px-4 py-2 text-sm">{x.content}</li>)}</ul> : <p className="t-secondary px-4 py-3">No memories were written.</p>}
          </div>
        </section>
        <section aria-labelledby="usage-h" id="usage" className="min-w-0"><h2 id="usage-h" className="label mb-2">USAGE</h2>
          <dl className="grid grid-cols-2 gap-px border border-line bg-line font-mono text-[12px] sm:grid-cols-4">{[["INPUT TOKENS", run.inputTokens.toLocaleString()], ["OUTPUT TOKENS", run.outputTokens.toLocaleString()], ["CACHED", run.cachedTokens.toLocaleString()], ["AI COST", fmtUsd(run.aiCost)], ["TOOL COST", fmtUsd(run.toolCost)], ["CHILD MACHINES", fmtUsd(run.childCost)], ["TOTAL", fmtUsd(run.cost)], ["PRICING", pricing?.inputPer1M != null ? `$${pricing.inputPer1M}/$${pricing.outputPer1M} per 1M` : "not configured"]].map(([k, v]) => <div key={k} className="bg-bg3 p-2.5"><dt className="text-[10px] text-dim">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}</dl>
          {!run.pricingKnown && <p className="t-caption mt-1">* Pricing for this model is not configured — usage shown without exact cost.</p>}
          {usage.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full border border-line text-xs"><thead><tr className="border-b border-line">{["#", "Model", "In", "Out", "Latency", "Finish", "Cost"].map((h) => <th key={h} className="label px-2 py-1.5 text-left font-normal">{h}</th>)}</tr></thead><tbody>{usage.map((u, i) => <tr key={u.id} className="border-b border-line/50 font-mono last:border-0"><td className="px-2 py-1">{i + 1}</td><td className="px-2 py-1">{u.model}</td><td className="px-2 py-1">{u.inputTokens}</td><td className="px-2 py-1">{u.outputTokens}</td><td className="px-2 py-1">{(u.latencyMs / 1000).toFixed(1)}s</td><td className="px-2 py-1">{u.finishReason}</td><td className="px-2 py-1">{u.cost == null ? "—" : fmtUsd(u.cost)}</td></tr>)}</tbody></table></div>}
        </section>
      </div>

      <section aria-labelledby="src"><h2 id="src" className="label mb-2">SOURCES · {sources.length} <span className="normal-case text-dim">· recorded from real tool results only</span></h2>
        {!sources.length ? <p className="t-secondary border border-dashed border-line p-4">{run.provider === "mock" ? "Mock Runtime does not record sources — tools were simulated." : "No sources were accessed in this run."}</p> : (
          <ol className="divide-y divide-line border border-line">{sources.map((s) => <li key={s.id} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 px-4 py-2 text-sm"><span className="font-mono text-amber">[{s.ref}]</span><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate hover:underline">{s.title || s.url}<span className="ml-2 font-mono text-[10px] text-dim">{(() => { try { return new URL(s.url).hostname; } catch { return ""; } })()}</span></a><span className="font-mono text-[10px] text-dim">{String((s.metadata as { kind?: string })?.kind ?? "").replace("_", " ").toUpperCase()}</span></li>)}</ol>)}
      </section>

      <section aria-labelledby="err"><h2 id="err" className="label mb-2">ERRORS · {errors.length}</h2>
        {!errors.length ? <p className="t-secondary border border-dashed border-line p-4">No errors recorded.</p> : <ul className="divide-y divide-line border border-bad/30">{errors.map((e, i) => <li key={i} className="grid grid-cols-[70px_1fr] gap-3 px-4 py-2 font-mono text-[12px]"><span className="text-dim">{e.at.toTimeString().slice(0, 8)}</span><span className="text-bad">{e.msg}</span></li>)}</ul>}
      </section>
    </div>
  );
}
