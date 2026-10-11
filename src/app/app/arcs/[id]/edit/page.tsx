import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { arcs } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { getArcDetail } from "@/lib/arcs/queries";
import { LazyArcBuilder } from "@/components/arcs/arc-client";

export default async function EditArc({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireSession();
  const d = await getArcDetail(id, workspace.id);
  if (!d) notFound();
  const [{ n }] = await db.select({ n: count() }).from(arcs).where(and(eq(arcs.workspaceId, workspace.id), isNull(arcs.deletedAt)));
  const firstArc = n <= 1 && !d.graph.nodes.some((x) => x.type === "machine");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><Link href={`/app/arcs/${id}`} className="t-caption py-1 tracking-widest hover:text-fg">← {d.arc.name}</Link><span className="t-caption hidden lg:inline">⌘Z UNDO · ⌘⇧Z REDO · ⌘S SAVE · ⌘D DUPLICATE · DEL REMOVE · ESC DESELECT</span></div>
      <h1 className="sr-only">Arc Builder — {d.arc.name}</h1>
      <LazyArcBuilder arc={{ id: d.arc.id, name: d.arc.name, arcCode: d.arc.arcCode, description: d.arc.description, objective: d.arc.objective, status: d.arc.status, triggerType: d.arc.triggerType, viewport: d.arc.viewport }} graph={d.graph} machines={d.machines} firstArc={firstArc} />
    </div>
  );
}
