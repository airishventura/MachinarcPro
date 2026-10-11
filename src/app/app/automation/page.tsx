import { headers } from "next/headers";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { arcs, eventTriggers, jobs, machines, schedules, triggerFires, webhooks } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { describeSchedule } from "@/lib/automation/cron";
import { queueStats } from "@/lib/queue/queue";
import { liveWorkers } from "@/lib/queue/worker";
import { ago } from "@/lib/domain";
import { PageHeader, Status } from "@/components/ui";
import { AutoRefresh } from "@/components/client-bits";
import { EventForm, RetryJob, RowActions, ScheduleForm, WebhookForm, type TargetOpt } from "@/components/automation/automation-client";

export const dynamic = "force-dynamic";

export default async function Automation() {
  const { workspace } = await requireSession();
  const ws = workspace.id;
  const [ms, as, sch, hooks, evs, fires, recent, stats, workers] = await Promise.all([
    db.select({ id: machines.id, name: machines.name }).from(machines).where(eq(machines.workspaceId, ws)),
    db.select({ id: arcs.id, name: arcs.name, status: arcs.status }).from(arcs).where(and(eq(arcs.workspaceId, ws), isNull(arcs.deletedAt))),
    db.select().from(schedules).where(eq(schedules.workspaceId, ws)).orderBy(desc(schedules.createdAt)),
    db.select().from(webhooks).where(eq(webhooks.workspaceId, ws)).orderBy(desc(webhooks.createdAt)),
    db.select().from(eventTriggers).where(eq(eventTriggers.workspaceId, ws)).orderBy(desc(eventTriggers.createdAt)),
    db.select().from(triggerFires).where(eq(triggerFires.workspaceId, ws)).orderBy(desc(triggerFires.createdAt)).limit(25),
    db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), inArray(jobs.status, ["queued", "running", "failed", "dead"]))).orderBy(desc(jobs.createdAt)).limit(15),
    queueStats(ws), liveWorkers(),
  ]);
  const targets: TargetOpt[] = [...ms.map((m) => ({ type: "machine" as const, id: m.id, name: m.name })), ...as.map((a) => ({ type: "arc" as const, id: a.id, name: `${a.name}${a.status === "deployed" ? "" : ` (${a.status})`}` }))];
  const name = (type: string, id: string) => targets.find((t) => t.type === type && t.id === id)?.name ?? "deleted";
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "machinarcpro.com"}`;
  const empty = (t: string, b: string) => <p className="t-secondary border border-dashed border-line p-4">{t} — {b}</p>;

  return (
    <div className="space-y-10">
      <AutoRefresh ms={5000} />
      <PageHeader title="AUTOMATION" sub="Schedules, webhooks and event triggers run Machines and Arcs continuously — executed by durable background workers."
        eyebrow={<div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="label">WORKERS</span><Status s={workers.length ? "online" : "failed"} /><span className="t-caption">{workers.length} live · {stats.running ?? 0} running · {stats.queued ?? 0} queued{stats.dead ? ` · ${stats.dead} dead-lettered` : ""}</span></div>} />

      <section aria-labelledby="rt" className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[["LIVE WORKERS", String(workers.length), workers.map((w) => w.mode).join(", ") || "none — jobs will wait"], ["QUEUED", String(stats.queued ?? 0), "due jobs are claimed within ~2s"], ["RUNNING", String(stats.running ?? 0), "leases renew every 60s"], ["COMPLETED", String(stats.completed ?? 0), `${stats.dead ?? 0} dead · ${stats.failed ?? 0} failed`]].map(([k, v, d]) => (
          <div key={k} className="bg-bg3 p-4"><div className="label">{k}</div><div className="t-metric mt-2">{v}</div><div className="t-caption mt-1">{d}</div></div>))}
        <h2 id="rt" className="sr-only">Runtime</h2>
      </section>

      <section aria-labelledby="sc" className="space-y-3">
        <h2 id="sc" className="t-section">SCHEDULES · {sch.length}</h2>
        {sch.length ? <ul className="divide-y divide-line border border-line">{sch.map((x) => (
          <li key={x.id} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0"><div className="truncate font-mono text-sm">{x.name}</div><div className="t-caption truncate">→ {x.targetType.toUpperCase()} · {name(x.targetType, x.targetId)}</div></div>
            <div className="font-mono text-xs">{describeSchedule(x)}{x.overlap === "skip" && <span className="text-dim"> · skip overlap</span>}</div>
            <div className="font-mono text-[11px] text-mute">{x.enabled && x.nextRunAt ? `next ${x.nextRunAt.toISOString().slice(11, 16)} UTC` : "paused"} · {x.runCount} runs{x.lastStatus ? ` · last ${x.lastStatus}` : ""}</div>
            <RowActions kind="schedule" id={x.id} enabled={x.enabled} />
          </li>))}</ul> : empty("NO SCHEDULES", "create one to run a Machine or Arc on a cadence.")}
        <ScheduleForm targets={targets} />
      </section>

      <section aria-labelledby="wh" className="space-y-3">
        <h2 id="wh" className="t-section">WEBHOOKS · {hooks.length}</h2>
        {hooks.length ? <ul className="divide-y divide-line border border-line">{hooks.map((x) => (
          <li key={x.id} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0"><div className="truncate font-mono text-sm">{x.name}</div><div className="t-caption truncate">→ {x.targetType.toUpperCase()} · {name(x.targetType, x.targetId)}</div></div>
            <div className="truncate font-mono text-[11px] text-mute">/api/hooks/whk_{x.tokenPrefix}_••••</div>
            <div className="font-mono text-[11px] text-mute">{x.callCount} calls{x.lastCalledAt ? ` · ${ago(x.lastCalledAt)}` : ""}</div>
            <RowActions kind="webhook" id={x.id} enabled={x.enabled} />
          </li>))}</ul> : empty("NO WEBHOOKS", "external systems can start Machines with an authenticated POST.")}
        <WebhookForm targets={targets} origin={origin} />
      </section>

      <section aria-labelledby="ev" className="space-y-3">
        <h2 id="ev" className="t-section">EVENT TRIGGERS · {evs.length}</h2>
        {evs.length ? <ul className="divide-y divide-line border border-line">{evs.map((x) => (
          <li key={x.id} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0 font-mono text-sm"><span className="text-mute">WHEN</span> {name(x.sourceType, x.sourceId)} <span className="text-amber">{x.onStatus.toUpperCase()}</span> <span className="text-mute">→ RUN</span> {name(x.targetType, x.targetId)}</div>
            <div className="font-mono text-[11px] text-mute">{x.fireCount} fires{x.lastFiredAt ? ` · ${ago(x.lastFiredAt)}` : ""}</div>
            <RowActions kind="event" id={x.id} enabled={x.enabled} />
          </li>))}</ul> : empty("NO EVENT TRIGGERS", "chain Machines and Arcs: when one finishes, start another.")}
        <EventForm targets={targets} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="hist"><h2 id="hist" className="t-section mb-3">TRIGGER HISTORY</h2>
          {fires.length ? <ol className="divide-y divide-line border border-line">{fires.map((f) => (
            <li key={f.id} className="grid grid-cols-[70px_80px_1fr] gap-2 px-3 py-2 text-xs"><span className="font-mono text-dim">{f.createdAt.toISOString().slice(11, 19)}</span><span className={`font-mono ${f.status === "started" ? "text-ok" : f.status === "skipped" ? "text-warn" : "text-bad"}`}>{f.status.toUpperCase()}</span><span className="min-w-0 truncate"><span className="font-mono text-mute">{f.source.toUpperCase()}</span> → {name(f.targetType, f.targetId)}{f.reason ? <span className="text-dim"> · {f.reason}</span> : null}</span></li>))}</ol> : empty("NO FIRES YET", "automated starts and skips are logged here.")}
        </section>
        <section aria-labelledby="q"><h2 id="q" className="t-section mb-3">QUEUE</h2>
          {recent.length ? <ul className="divide-y divide-line border border-line">{recent.map((j) => (
            <li key={j.id} className="grid grid-cols-[110px_90px_1fr_auto] items-center gap-2 px-3 py-2 text-xs"><span className="font-mono">{j.kind}</span><span className={`font-mono ${j.status === "dead" || j.status === "failed" ? "text-bad" : j.status === "running" ? "text-proc" : "text-mute"}`}>{j.status.toUpperCase()}</span><span className="truncate text-dim">{j.lastError ?? `attempt ${j.attempts}/${j.maxAttempts} · ${ago(j.createdAt)}`}</span>{j.status === "dead" ? <RetryJob id={j.id} /> : <span />}</li>))}</ul> : empty("QUEUE IDLE", "no pending, running or failed jobs.")}
        </section>
      </div>
    </div>
  );
}
