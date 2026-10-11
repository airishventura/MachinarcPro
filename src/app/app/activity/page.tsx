import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { AutoRefresh } from "@/components/client-bits";
import { ago, hhmmss } from "@/lib/domain";

const FILTERS = ["all", "machines", "arcs", "economy", "security", "system"];

export default async function Activity({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "all" } = await searchParams;
  const { workspace } = await requireSession();
  const where = f !== "all" && FILTERS.includes(f) ? and(eq(activities.workspaceId, workspace.id), eq(activities.category, f)) : eq(activities.workspaceId, workspace.id);
  const rows = await db.select().from(activities).where(where).orderBy(desc(activities.createdAt)).limit(150);
  return (
    <div className="space-y-6">
      <AutoRefresh ms={6000} />
      <PageHeader title="ACTIVITY" sub="Every event across your Machines, Arcs and economy." />
      <nav className="no-scrollbar flex overflow-x-auto border border-line w-fit max-w-full">
        {FILTERS.map((x) => <Link key={x} href={x === "all" ? "/app/activity" : `/app/activity?f=${x}`} aria-current={f === x ? "page" : undefined} className={`px-4 py-2 font-mono text-[11px] tracking-widest ${f === x ? "bg-fg text-bg" : "text-mute hover:text-fg"}`}>{x.toUpperCase()}</Link>)}
      </nav>
      <ol className="border border-line">
        {rows.length === 0 && <li className="p-12 text-center font-mono text-xs text-mute">SIGNAL QUIET — no events in this channel yet.</li>}
        {rows.map((a) => (
          <li key={a.id} className="grid grid-cols-[64px_10px_1fr] items-start gap-3 border-b border-line/60 px-4 py-3 last:border-0 md:grid-cols-[80px_10px_110px_1fr_90px]">
            <span className="font-mono text-[11px] text-dim tabular-nums">{hhmmss(a.createdAt)}</span>
            <span className={`mt-1.5 h-1.5 w-1.5 ${a.severity === "success" ? "bg-ok" : a.severity === "warning" ? "bg-warn" : a.severity === "critical" ? "bg-bad" : "bg-dim"}`} />
            <span className="label hidden md:block">{a.category}</span>
            <span className="text-sm">{a.message}</span>
            <span className="hidden text-right font-mono text-[11px] text-dim md:block">{ago(a.createdAt)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
