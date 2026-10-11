import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { NewArcForm, TemplateGrid } from "@/components/arcs/arc-client";
import { ARC_TEMPLATES } from "@/config/arc-templates";

export default function NewArc() {
  return (
    <div className="space-y-8">
      <PageHeader title="NEW ARC" sub="Define the system's goal, then assemble Machines on the canvas."><Link href="/app/arcs" className="btn">Cancel</Link></PageHeader>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <NewArcForm />
        <aside className="h-fit border border-line p-5">
          <div className="t-section">HOW ARCS WORK</div>
          <ol className="mt-4 space-y-4 text-sm">
            {[["TRIGGER", "Starts an Arc Run with an input."], ["MACHINES", "Execute in order, passing output forward via {{Node.output}}."], ["LOGIC", "Decisions branch TRUE / FALSE. Human Review pauses for approval."], ["OUTPUT", "Defines the final result of each run."]].map(([k, v], i) => <li key={k} className="grid grid-cols-[24px_1fr] gap-2"><span className="font-mono text-xs text-amber">0{i + 1}</span><span><span className="block font-mono text-xs tracking-widest">{k}</span><span className="t-secondary">{v}</span></span></li>)}
          </ol>
        </aside>
      </div>
      <section><h2 className="t-section mb-3">OR START FROM A TEMPLATE</h2><TemplateGrid templates={ARC_TEMPLATES} /></section>
    </div>
  );
}
