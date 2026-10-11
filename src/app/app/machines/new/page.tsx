import Link from "next/link";
import { MachineBuilder, type Availability } from "@/components/machines/machine-builder";
import { PageHeader } from "@/components/ui";
import { STARTERS } from "@/lib/domain";
import { requireSession } from "@/lib/auth";
import { providerConfigured } from "@/lib/integrations/service";
import { ToolRegistry, type CustomApiConfig } from "@/lib/tools/registry";
import { draftDefaults, type MachineDraft } from "@/lib/machines/drafts";

export default async function NewMachine({ searchParams }: { searchParams: Promise<{ starter?: string }> }) {
  const { starter } = await searchParams;
  const { workspace } = await requireSession();
  const [openai, anthropic, apis] = await Promise.all([providerConfigured(workspace.id, "openai"), providerConfigured(workspace.id, "anthropic"), ToolRegistry.customApis(workspace.id)]);
  const available: Availability = { openai, anthropic, mock: "simulated", customApis: apis.map((a) => ({ slug: a.slug, name: a.name, actions: (a.config as unknown as CustomApiConfig).actions?.length ?? 0, status: a.status })) };
  let initial: Partial<MachineDraft> | undefined;
  let from: string | undefined;
  const s = starter ? STARTERS[starter] : undefined;
  if (s) {
    from = s.label;
    const base = draftDefaults();
    initial = { name: s.name, machineType: s.type, description: s.description, objective: s.objective, successCriteria: s.successCriteria, systemPrompt: s.systemPrompt,
      ...(s.tools ? { tools: base.tools.map((x) => ({ ...x, enabled: s.tools!.includes(x.id) })) } : {}), ...(s.memoryMode ? { memoryMode: s.memoryMode } : {}),
      ...(s.outputMode ? { outputMode: s.outputMode, outputSchema: s.outputSchema ?? null } : {}) };
  }
  return (
    <div className="space-y-6">
      <PageHeader title="NEW MACHINE" sub={from ? `Prefilled from ${from}. Every field is editable.` : "Define, equip and deploy an autonomous digital system."}>
        {from && <Link href="/app/machines/new" className="btn">Start from scratch</Link>}
      </PageHeader>
      {!openai && !anthropic && (
        <div className="flex flex-col gap-2 border border-warn/40 bg-warn/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="t-section !text-warn">NO AI PROVIDER CONNECTED</div><p className="t-secondary mt-1">Connect a provider to execute real Machine tasks. Until then, Machines run on Mock Runtime with simulated tools.</p></div>
          <Link href="/app/settings/integrations" className="btn">Connect Provider</Link>
        </div>
      )}
      <MachineBuilder key={starter ?? "blank"} initial={initial} available={available} />
    </div>
  );
}
