import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getArcForWorkspace } from "@/lib/arcs/service";
import { getRunState } from "@/lib/arcs/queries";
import { workspaceMachines } from "@/lib/arcs/runtime";
import { RunView } from "@/components/arcs/run-view";

export default async function RunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const { workspace } = await requireSession();
  const arc = await getArcForWorkspace(id, workspace.id);
  if (!arc) notFound();
  const state = await getRunState(workspace.id, id, runId);
  if (!state) notFound();
  return (
    <div className="space-y-4">
      <nav className="t-caption flex flex-wrap gap-2 tracking-widest"><Link href="/app/arcs" className="hover:text-fg">ARCS</Link><span>/</span><Link href={`/app/arcs/${id}`} className="hover:text-fg">{arc.name}</Link><span>/</span><Link href={`/app/arcs/${id}?tab=runs`} className="hover:text-fg">RUNS</Link></nav>
      <RunView arcId={id} arcName={arc.name} initial={state} machines={await workspaceMachines(workspace.id)} />
    </div>
  );
}
