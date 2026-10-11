import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listMachines } from "@/lib/machines/queries";
import { PageHeader } from "@/components/ui";
import { MachineList } from "@/components/machines/machine-list";

export default async function MachinesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; view?: string }> }) {
  const sp = await searchParams;
  const { workspace } = await requireSession();
  const rows = await listMachines(workspace.id);
  return (
    <div className="space-y-6">
      <PageHeader title="MACHINES" sub="Create and manage autonomous digital systems.">
        <Link href="/app/machines/new" className="btn btn-primary">+ New Machine</Link>
      </PageHeader>
      <MachineList
        rows={rows.map((r) => ({ ...r, lastActiveAt: r.lastActiveAt?.toISOString() ?? null }))}
        initial={{ status: ["running", "idle", "paused", "failed"].includes(sp.status ?? "") ? sp.status! : "all", q: sp.q ?? "", view: sp.view === "list" ? "list" : "grid" }}
      />
    </div>
  );
}
