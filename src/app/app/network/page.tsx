import { eq } from "drizzle-orm";
import { db } from "@/db";
import { machines } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { NetworkMarket } from "@/components/network-market";
import { NetworkField } from "@/components/landing-viz";

export default async function NetworkPage() {
  const { workspace } = await requireSession();
  const mine = await db.select({ id: machines.id, name: machines.name }).from(machines).where(eq(machines.workspaceId, workspace.id));
  return (
    <div className="space-y-6">
      <PageHeader title="MACHINE NETWORK" sub="Demonstration catalog. Machines, ratings, task counts, owners and prices are examples. No external Machine executes or Credits move." />
      <div className="relative hidden h-40 overflow-hidden border border-line bg-bg2 md:block">
        <div className="absolute inset-0 opacity-70"><NetworkField /></div>
        <div className="absolute bottom-4 left-4 font-mono text-[11px] tracking-widest text-mute">SIMULATED NETWORK · EXAMPLE MACHINES</div>
      </div>
      <NetworkMarket mine={mine} />
    </div>
  );
}
