import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { STARTERS, TYPE_LABEL } from "@/lib/domain";
import { ARC_TEMPLATES } from "@/config/arc-templates";
import { TemplateGrid } from "@/components/arcs/arc-client";

export default function Templates() {
  const starters = Object.entries(STARTERS).sort(([, a], [, b]) => Number(!!b.flagship) - Number(!!a.flagship));
  return (
    <div className="space-y-10">
      <PageHeader title="TEMPLATES" sub="Prebuilt Machines and Arcs. Every template opens in the builder, fully editable." />
      <section aria-labelledby="mt">
        <h2 id="mt" className="t-section mb-3">MACHINE TEMPLATES</h2>
        <div className="stagger grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {starters.map(([key, s]) => (
            <Link key={key} href={`/app/machines/new?starter=${key}`} className="card-hover group flex flex-col bg-bg3 p-4 hover:bg-panel">
              <div className="flex items-start justify-between gap-2"><span className="font-mono tracking-wider">{s.label.toUpperCase()}</span>{s.flagship && <span className="border border-amber/50 px-1.5 font-mono text-[9px] tracking-widest text-amber">REAL TOOLS</span>}</div>
              <span className="t-caption mt-0.5">{TYPE_LABEL[s.type]} · {s.description}</span>
              <p className="t-secondary mt-2 flex-1">{s.objective}</p>
              <div className="mt-3 flex flex-wrap gap-1">{(s.tools ?? []).map((t) => <span key={t} className="border border-line px-1.5 font-mono text-[10px] text-mute">{t}</span>)}</div>
              <span className="t-caption mt-3 group-hover:text-fg">USE TEMPLATE <span className="card-arrow">→</span></span>
            </Link>
          ))}
        </div>
      </section>
      <section aria-labelledby="at"><h2 id="at" className="t-section mb-3">ARC TEMPLATES</h2><TemplateGrid templates={ARC_TEMPLATES} /></section>
    </div>
  );
}
