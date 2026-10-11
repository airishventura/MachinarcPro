import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getDashboard, pendingToolApprovals, toApproval } from "@/lib/machines/queries";
import { DashboardAuthorization } from "@/components/dashboard/authorization";
import { getArcDashboard } from "@/lib/arcs/queries";
import { RecentArcRuns } from "@/components/dashboard/sections";
import { STARTERS } from "@/lib/domain";
import { fmtUsd } from "@/lib/utils/format";
import { Kpi, PageHeader, Section, Status } from "@/components/ui";
import { AutoRefresh, Clock } from "@/components/client-bits";
import { ActiveMachines, ActivityFeed, NetworkPanel } from "@/components/dashboard/sections";

export default async function CommandCenter() {
  const { workspace } = await requireSession();
  const [{ machines, activities, metrics: k }, arcsDash, toolAps] = await Promise.all([getDashboard(workspace.id), getArcDashboard(workspace.id), pendingToolApprovals(workspace.id)]);
  const arcLive = arcsDash.recent.some((r) => ["queued", "running", "waiting_delay"].includes(r.status));
  const failed = machines.filter((m) => m.status === "failed");
  const empty = machines.length === 0;

  return (
    <div className="space-y-6">
      <AutoRefresh ms={k.running || arcLive ? 3000 : 10000} />
      <PageHeader title="COMMAND CENTER" sub={`${workspace.name} · ${empty ? "No Machines deployed" : `${machines.length} Machine${machines.length > 1 ? "s" : ""} under operation`}`}
        eyebrow={<div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="label">SYSTEM</span><Status s={failed.length ? "failed" : "online"} />{failed.length ? <span className="t-caption !text-bad">DEGRADED · {failed.length} FAULT</span> : <span className="t-caption">OPERATIONAL</span>}<span className="t-caption"><Clock /></span></div>}>
        <Link href="/app/machines/new" className="btn btn-primary">+ New Machine</Link>
      </PageHeader>

      {toolAps.length > 0 && <section aria-label="Authorization required" className="grid gap-3 xl:grid-cols-2">{toolAps.map((x) => <DashboardAuthorization key={x.a.id} a={toApproval(x.a)} machineName={x.machineName} machineId={x.machineId} />)}</section>}
      {failed.length > 0 && (
        <section aria-label="Requires attention" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {failed.map((m) => <Link key={m.id} href={`/app/machines/${m.id}`} className="border border-bad/40 bg-bad/5 p-4 hover:bg-bad/10"><div className="t-section !text-bad">MACHINE FAULT</div><div className="mt-2 font-mono">{m.name}</div><div className="t-secondary">Last run failed. Inspect execution →</div></Link>)}
        </section>
      )}

      <section aria-labelledby="kpi-h">
        <div className="mb-2 flex items-baseline justify-between"><h2 id="kpi-h" className="label">YOUR WORKSPACE</h2><span className="t-caption">LIVE</span></div>
        <div className="stagger grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Machines Online" value={`${k.online}`} hint={empty ? "deploy to begin" : `of ${k.total} deployed`} tone={!empty && k.online === k.total ? "ok" : undefined} />
          <Kpi label="Tasks Running" value={String(k.running)} hint={k.running ? "executing now" : "none active"} tone={k.running ? "ok" : undefined} />
          <Kpi label="Tasks Completed" value={k.completed.toLocaleString()} hint="all time" />
          <Kpi label="Success Rate" value={k.successRate === null ? "—" : `${k.successRate.toFixed(1)}%`} hint={k.successRate === null ? "no runs yet" : k.successRate >= 95 ? "nominal" : "below target"} tone={k.successRate === null ? undefined : k.successRate >= 95 ? "ok" : "warn"} />
          <Kpi label="Active Arcs" value={String(arcsDash.activeArcs)} hint={`of ${arcsDash.totalArcs} Arcs`} tone={arcsDash.activeArcs ? "ok" : undefined} />
          <Kpi label="Arc Runs Today" value={String(arcsDash.runsToday)} hint={arcLive ? "executing now" : "since midnight"} tone={arcLive ? "ok" : undefined} />
          <div className="col-span-2 md:col-span-1"><Kpi label="Spend Today" value={fmtUsd(k.spendToday)} hint={k.dailyBudget ? `of $${k.dailyBudget.toFixed(0)} daily budget` : "no budget allocated"} /></div>
        </div>
      </section>

      {empty && (
        <section className="grid-bg border border-dashed border-line p-6 md:p-10">
          <div className="t-section">NO MACHINES DEPLOYED</div>
          <p className="t-secondary mt-2 max-w-md">Your workspace does not contain any Machines yet. Create one to begin operating on MachinArc.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/app/machines/new" className="btn btn-primary">Create Machine</Link>
            {Object.entries(STARTERS).map(([key, s]) => <Link key={key} href={`/app/machines/new?starter=${key}`} className="btn">{s.label}</Link>)}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {!empty && (
            <Section title="ACTIVE MACHINES" right={<Link href="/app/machines" className="t-caption hover:text-fg">ALL →</Link>}>
              <ActiveMachines machines={machines.slice(0, 8)} />
            </Section>
          )}
          {arcsDash.recent.length > 0 && (
            <Section title="RECENT ARC RUNS" right={<Link href="/app/arcs" className="t-caption hover:text-fg">ARCS →</Link>}>
              <RecentArcRuns runs={arcsDash.recent} />
            </Section>
          )}
          <NetworkPanel />
        </div>
        <Section title="ACTIVITY" right={<span className="flex items-center gap-1.5 font-mono text-[10px] text-ok"><span aria-hidden className="dot-live h-1.5 w-1.5 rounded-full bg-ok" />LIVE</span>} className="h-fit min-w-0">
          <ActivityFeed items={activities} />
        </Section>
      </div>
    </div>
  );
}
