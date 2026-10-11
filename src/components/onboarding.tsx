"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishOnboarding } from "@/app/actions";
import { Glyph, Logo } from "@/components/ui";
import { STARTERS, TYPE_LABEL } from "@/lib/domain";

export function Onboarding({ name }: { name: string }) {
  const r = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const go = (href: string) => start(async () => { await finishOnboarding(); r.push(href); });
  return (
    <main className="grid-bg flex min-h-screen flex-col">
      <div className="flex items-center justify-between px-5 py-5 sm:px-8"><Logo /><button disabled={pending} onClick={() => go("/app")} className="t-caption min-h-11 px-2 tracking-widest hover:text-fg">SKIP TO COMMAND CENTER →</button></div>
      <div className="m-auto w-full max-w-2xl px-5 pb-16">
        <div className="mb-10 flex gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step + 1} aria-label="Onboarding progress">{[0, 1].map((i) => <div key={i} className={`h-px flex-1 transition-colors ${i <= step ? "bg-amber" : "bg-line"}`} />)}</div>
        {step === 0 ? (
          <div className="fade-up">
            <div className="label">01 / 02 · OPERATOR {name.toUpperCase()}</div>
            <h1 className="mt-4 text-4xl font-medium tracking-tight md:text-5xl">WELCOME TO MACHINARC</h1>
            <p className="mt-5 max-w-lg text-lg text-mute">MachinArc lets you create autonomous Machines that operate continuously toward a defined objective.</p>
            <ul className="mt-8 grid gap-px border border-line bg-line sm:grid-cols-3">
              {[["CREATE", "Define identity and objective"], ["DEPLOY", "Bring it online with safe defaults"], ["OBSERVE", "Watch every run, live"]].map(([k, v], i) => <li key={k} className="bg-bg p-4"><div className="t-caption">0{i + 1}</div><div className="mt-2 font-mono text-sm tracking-widest">{k}</div><div className="t-secondary">{v}</div></li>)}
            </ul>
            <button onClick={() => setStep(1)} className="btn btn-primary mt-10 h-12 px-6">Create First Machine</button>
          </div>
        ) : (
          <div className="fade-up">
            <div className="label">02 / 02</div>
            <h1 className="mt-4 text-3xl font-medium tracking-tight md:text-4xl">CHOOSE A STARTING POINT</h1>
            <p className="t-secondary mt-2">Selecting a type prefills the Machine Builder. Everything stays editable.</p>
            <div className="mt-8 grid gap-px border border-line bg-line sm:grid-cols-2">
              {Object.entries(STARTERS).map(([k, s]) => (
                <button key={k} disabled={pending} onClick={() => go(`/app/machines/new?starter=${k}`)} className="group flex items-start gap-3 bg-bg3 p-5 text-left transition-colors hover:bg-panel2 focus-visible:bg-panel2">
                  <Glyph code={s.name} />
                  <div className="min-w-0"><div className="font-mono tracking-wider">{s.label.toUpperCase()}</div><div className="t-caption">{TYPE_LABEL[s.type]}</div><div className="t-secondary mt-1.5">{s.description}</div></div>
                  <span className="ml-auto font-mono text-mute transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-2"><button onClick={() => setStep(0)} className="btn">Back</button><button disabled={pending} onClick={() => go("/app/machines/new")} className="btn">Start from scratch</button></div>
          </div>
        )}
      </div>
    </main>
  );
}
