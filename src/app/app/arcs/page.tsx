import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listArcs } from "@/lib/arcs/queries";
import { ARC_TEMPLATES } from "@/config/arc-templates";
import { PageHeader } from "@/components/ui";
import { ArcList, TemplateGrid } from "@/components/arcs/arc-client";
import { AutoRefresh } from "@/components/client-bits";

export default async function ArcsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; view?: string }> }) {
  const sp = await searchParams;
  const { workspace } = await requireSession();
  const rows = await listArcs(workspace.id);
  const live = rows.some((r) => r.status === "running");
  return (
    <div className="space-y-8">
      {live && <AutoRefresh ms={4000} />}
      <div className="space-y-6">
        <PageHeader title="ARCS" sub="Coordinate multiple Machines into autonomous systems."><Link href="/app/arcs/new" className="btn btn-primary">+ New Arc</Link></PageHeader>
        <ArcList rows={rows} initial={{ status: ["running", "idle", "draft", "failed", "paused"].includes(sp.status ?? "") ? sp.status! : "all", q: sp.q ?? "", view: sp.view === "list" ? "list" : "grid" }} />
      </div>
      <section aria-labelledby="tpl-h">
        <div className="mb-3 flex items-baseline justify-between"><h2 id="tpl-h" className="t-section">ARC TEMPLATES</h2><span className="t-caption">Prebuilt systems · copied into your workspace</span></div>
        <TemplateGrid templates={ARC_TEMPLATES.filter((t) => !t.hidden)} />
      </section>
    </div>
  );
}
