import { getEconomyState } from "@/lib/economy/queries";
import { requireSession } from "@/lib/auth";
import { Kpi, PageHeader, Section, Status } from "@/components/ui";
import { AreaChart } from "@/components/charts";
import { hhmmss, money } from "@/lib/domain";

export default async function Economy() {
  const { workspace: ws } = await requireSession();
  const { txs, totals: { revenue, spend, count, avg }, usage, perMachine, compute, unknown } = await getEconomyState(ws.id);
  const net = revenue - spend;
  const maxC = Math.max(1, ...perMachine.map((p) => p.cost));
  return (
    <div className="space-y-6">
      <PageHeader title="ECONOMY" sub="Lifetime completed Credit transactions. Provider cost estimates are reported separately in USD and exclude Mock Runtime. Credits are internal units, not cash or an onchain token; they have no conversion to a proposed community token." eyebrow={<span className="label">BALANCE · <span className="text-fg">{money(ws.credits)} Cr</span></span>} />
      <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Machine Revenue" value={money(revenue)} hint="Credits in" tone="ok" />
        <Kpi label="Machine Spend" value={money(spend)} hint="network hires" />
        <Kpi label="Transactions" value={String(count)} hint="completed · lifetime" />
        <Kpi label="Avg Task Price" value={money(avg)} hint="Credits · completed" />
        <Kpi label="Provider Estimate" value={`$${compute.toFixed(4)}`} hint={unknown ? `USD · ${unknown} unpriced records excluded` : "USD · known estimates"} />
        <Kpi label="Net Credits" value={money(net)} tone={net >= 0 ? "ok" : "bad"} hint="Credits in minus out" />
      </div>
      <Section title="TRANSACTIONS · LATEST 100">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="border-b border-line text-left">{["Time", "From", "To", "Purpose", "Amount", "Status"].map((h) => <th key={h} className={`label px-4 py-2 font-normal ${h === "Amount" ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{txs.length === 0 ? <tr><td colSpan={6} className="p-10 text-center font-mono text-xs text-mute">NO CREDIT TRANSACTIONS — Network simulations do not move Credits.</td></tr> : txs.map((t) => (
              <tr key={t.id} className="border-b border-line/60 hover:bg-panel">
                <td className="px-4 py-2.5 font-mono text-xs text-dim">{hhmmss(t.createdAt).slice(0, 5)}</td><td className="px-4 py-2.5 font-mono">{t.fromName}</td><td className="px-4 py-2.5 font-mono">{t.toName}</td>
                <td className="px-4 py-2.5 text-mute">{t.purpose}</td><td className={`px-4 py-2.5 text-right font-mono tabular-nums ${t.direction === "in" ? "text-ok" : ""}`}>{t.direction === "in" ? "+" : "-"}{money(t.amount)}</td><td className="px-4 py-2.5"><Status s={t.status} /></td>
              </tr>))}</tbody>
          </table>
        </div>
      </Section>
      <div id="usage" className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Section title="PROVIDER ESTIMATES · USD · LATEST 48 RECORDS"><div className="p-4"><AreaChart data={usage.filter((u) => u.cost !== null).map((u) => u.cost!)} /></div></Section>
        <Section title="PROVIDER ESTIMATES BY MACHINE · USD">
          <ul className="space-y-3 p-4">{perMachine.map((p) => (
            <li key={p.id}><div className="flex justify-between font-mono text-xs"><span>{p.name}</span><span className="tabular-nums">${p.cost.toFixed(4)}</span></div><div className="mt-1 h-1 bg-line"><div className="h-1 bg-amber" style={{ width: `${(p.cost / maxC) * 100}%` }} /></div></li>
          ))}</ul>
        </Section>
      </div>
    </div>
  );
}
