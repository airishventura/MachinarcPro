import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { machineMemories, machinePermissions, machineTools } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { getMachineDetail } from "@/lib/machines/queries";
import { ToolRegistry } from "@/lib/tools/registry";
import { MachineConsole } from "@/components/machines/machine-console";

export default async function MachineDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ task?: string }> }) {
  const { id } = await params;
  const { task } = await searchParams;
  const { workspace } = await requireSession();
  const detail = await getMachineDetail(id, workspace.id, task);
  if (!detail || !detail.state) notFound();
  const { machine: m, tasks, state } = detail;
  const [perms, tools, memories, apis] = await Promise.all([
    db.select({ permission: machinePermissions.permission, mode: machinePermissions.mode }).from(machinePermissions).where(eq(machinePermissions.machineId, id)),
    db.select({ tool: machineTools.tool, enabled: machineTools.enabled, config: machineTools.config }).from(machineTools).where(eq(machineTools.machineId, id)),
    db.select().from(machineMemories).where(eq(machineMemories.machineId, id)).orderBy(desc(machineMemories.pinned), desc(machineMemories.createdAt)).limit(200),
    ToolRegistry.customApis(workspace.id),
  ]);
  return (
    <div className="space-y-4">
      <Link href="/app/machines" className="t-caption inline-block py-1 tracking-widest hover:text-fg">← MACHINES</Link>
      <MachineConsole
        m={{ ...m, createdAt: m.createdAt.toISOString(), lastActiveAt: m.lastActiveAt?.toISOString() ?? null }}
        tasks={tasks} initial={state} perms={perms} tools={tools}
        memories={memories.map((x) => ({ id: x.id, content: x.content, kind: x.kind, importance: x.importance, source: x.source, pinned: x.pinned, usedCount: x.usedCount, createdAt: x.createdAt.toISOString() }))}
        customApis={apis.map((a) => ({ slug: a.slug, name: a.name }))}
      />
    </div>
  );
}
