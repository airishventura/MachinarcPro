"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryDeployAction, runTaskAction, setMachineStatus, updateMachineAction } from "@/app/actions";
import { deleteMemoryAction, pinMemoryAction, saveMemoryAction, setMachineToolAction, setPermissionModeAction, stopRunAction, updateMachineLimitsAction } from "@/app/runtime-actions";
import { Glyph, Status } from "@/components/ui";
import { Terminal } from "@/components/machines/terminal";
import { AuthorizationCard, FailureBanner, ResultView, Telemetry, ToolDetail } from "@/components/machines/runtime-parts";
import { TYPE_LABEL, ago } from "@/lib/domain";
import { MEMORY_MODES, PERMISSIONS, TOOL_CATALOG, toolMeta, type PermissionMode } from "@/config/tools";
import { PROVIDERS, getModel } from "@/config/models";
import { fmtDuration, fmtUsd } from "@/lib/utils/format";
import type { MachineStateDTO, TaskDTO } from "@/types/machine";

export type ConsoleMachine = {
  id: string; name: string; machineCode: string; machineType: string; status: string; description: string; objective: string; successCriteria: string; systemPrompt: string;
  modelProvider: string; modelName: string; dailyBudget: number; monthlyBudget: number; maxTaskCost: number; maxRuntimeSec: number; maxToolCalls: number; maxTurns: number; memoryMode: string; outputMode: string;
  tasksCompleted: number; successRate: number; totalCost: number; totalRuntimeMs: number; createdAt: string; lastActiveAt: string | null;
};
export type MemoryRow = { id: string; content: string; kind: string; importance: number; source: string; pinned: boolean; usedCount: number; createdAt: string };
type Perm = { permission: string; mode: string };
type ToolRow = { tool: string; enabled: boolean; config: Record<string, unknown> };

const TABS = ["Overview", "Tasks", "Memory", "Tools", "Logs", "Configuration"] as const;
const ACTIVE = ["queued", "initializing", "running", "waiting_tool", "waiting_approval"];
const isActive = (s?: string | null) => !!s && ACTIVE.includes(s);
const STAGES = [["INPUT", "Task, memory, context"], ["REASON", "Model plans next step"], ["EXECUTE", "Tools under permission"], ["OUTPUT", "Validated result"]] as const;

function stageOf(level?: string, status?: string): number {
  if (status === "completed") return 4;
  if (!level) return -1;
  if (["SYSTEM", "MEMORY"].includes(level)) return 0;
  if (["AI", "PLAN"].includes(level)) return 1;
  if (level.startsWith("TOOL") || ["PERMISSION", "APPROVAL", "MACHINE CALL", "MACHINE RESULT"].includes(level)) return 2;
  if (["ANALYSIS", "OUTPUT"].includes(level)) return 3;
  return 1;
}

export function MachineConsole({ m, tasks, initial, perms, tools, memories, customApis }: { m: ConsoleMachine; tasks: TaskDTO[]; initial: MachineStateDTO; perms: Perm[]; tools: ToolRow[]; memories: MemoryRow[]; customApis: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [state, setState] = useState(initial);
  const [taskId, setTaskId] = useState<string | null>(initial.task?.id ?? null);
  const [notice, setNotice] = useState<null | { tone: "ok" | "bad"; msg: string }>(null);
  const [toolSel, setToolSel] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const status = state.machine.status;
  const runStatus = state.run?.status ?? state.task?.status;
  const live = isActive(runStatus) || status === "initializing";
  const wasLive = useRef(live);

  const poll = useCallback(async (tid: string | null) => {
    try { const r = await fetch(`/api/machines/${m.id}/state${tid ? `?task=${tid}` : ""}`, { cache: "no-store" }); if (r.ok) setState(await r.json()); } catch { /* retry next tick */ }
  }, [m.id]);
  useEffect(() => { if (!live) return; const t = setInterval(() => poll(taskId), runStatus === "waiting_approval" ? 2500 : 700); return () => clearInterval(t); }, [live, taskId, poll, runStatus]);
  // Edge-triggered: announce completion once when a run transitions from live → settled.
  useEffect(() => {
    if (wasLive.current && !live) {
      router.refresh();
      const st = state.task?.status;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (st === "completed") setNotice({ tone: "ok", msg: `TASK #${state.task!.number} COMPLETE` });
      else if (st && st !== "completed") setNotice({ tone: "bad", msg: `TASK #${state.task!.number} ${st.replace("_", " ").toUpperCase()}` });
    }
    wasLive.current = live;
  }, [live, state.task, router]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4500); return () => clearTimeout(t); }, [notice]);

  const select = (id: string) => { setTaskId(id); setToolSel(null); poll(id); };
  const execute = async (input: string) => {
    const r = await runTaskAction(m.id, input);
    if ("error" in r) return r.error;
    setTaskId(r.taskId); setToolSel(null);
    setState((s) => ({ ...s, machine: { ...s.machine, status: "running" }, task: { id: r.taskId, number: 0, input, output: null, status: "queued", cost: 0, tokens: 0, durationMs: 0, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, result: null, source: "operator" }, run: null, logs: [], tools: [], approval: null }));
    setTab("Overview"); poll(r.taskId);
    return null;
  };
  const changeStatus = (s: "paused" | "idle") => start(async () => { const r = await setMachineStatus(m.id, s); if (r && "error" in r && r.error) setNotice({ tone: "bad", msg: r.error }); await poll(taskId); router.refresh(); });
  const stop = () => start(async () => { if (!state.run) return; const r = await stopRunAction(state.run.id); if (!r.ok) setNotice({ tone: "bad", msg: r.error }); await poll(taskId); });

  const last = state.logs[state.logs.length - 1];
  const stage = live ? stageOf(last?.level, runStatus) : state.task?.status === "completed" ? 4 : -1;
  const currentAction = runStatus === "waiting_approval" ? "WAITING FOR APPROVAL" : live ? `${last?.level ?? "QUEUED"} · ${last?.message ?? "Queued"}` : state.task ? `Last run ${state.task.status.replace("_", " ")}` : "Idle — awaiting task";
  const paused = status === "paused";
  const selectedTool = state.tools.find((t) => t.id === toolSel) ?? null;
  const provider = PROVIDERS[m.modelProvider as keyof typeof PROVIDERS]?.label ?? m.modelProvider;
  const failed = state.task && !isActive(state.task.status) && state.task.status !== "completed";

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-5 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Glyph code={m.machineCode} size={52} active={status === "running"} />
          <div className="min-w-0">
            <h1 className="t-title truncate">{m.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1"><span className="t-caption">{m.machineCode}</span><span className="t-caption">{TYPE_LABEL[m.machineType]}</span><span className="t-caption">{m.modelProvider === "mock" ? "MOCK RUNTIME" : `${provider} · ${getModel(m.modelProvider, m.modelName)?.name ?? m.modelName}`}</span><Status s={status} /></div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          {live && state.run ? <button className="btn btn-danger" disabled={pending || state.run.cancelRequested} onClick={stop}>{state.run.cancelRequested ? "Stopping…" : "Stop Run"}</button>
            : <button className="btn btn-primary" disabled={paused || status === "initializing"} onClick={() => dialog.current?.showModal()}>Run Task</button>}
          {paused ? <button className="btn" disabled={pending} onClick={() => changeStatus("idle")}>Resume</button> : <button className="btn" disabled={pending || status === "initializing"} onClick={() => changeStatus("paused")}>Pause</button>}
          <button className="btn" onClick={() => setTab("Configuration")}>Edit</button>
        </div>
      </header>

      {state.approval && <AuthorizationCard a={state.approval} machineName={m.name} onDone={() => { poll(taskId); router.refresh(); }} />}
      {paused && (
        <div className="flex flex-col gap-3 border border-warn/40 bg-warn/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div><div className="t-section !text-warn">MACHINE PAUSED</div><p className="t-secondary mt-1">Resume Machine to execute tasks.{live ? " The active run will finish." : ""}</p></div>
          <button className="btn" disabled={pending} onClick={() => changeStatus("idle")}>Resume Machine</button>
        </div>
      )}
      {status === "failed" && !live && state.logs.some((l) => l.message.startsWith("Initialization failed")) && (
        <div className="flex items-center justify-between gap-3 border border-bad/40 bg-bad/5 p-4" role="alert"><div className="t-section !text-bad">INITIALIZATION FAILED</div><button className="btn" onClick={() => start(async () => { await retryDeployAction(m.id); await poll(null); })}>Retry initialization</button></div>
      )}
      {notice && <div role="status" className={`${notice.tone === "ok" ? "success-pop" : "fade-up"} border px-4 py-2.5 font-mono text-xs tracking-wider ${notice.tone === "ok" ? "border-ok/40 bg-ok/5 text-ok" : "border-bad/40 bg-bad/5 text-bad"}`}>{notice.msg}</div>}

      <div className="no-scrollbar -mx-4 flex overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0" role="tablist" aria-label="Machine sections">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative min-h-11 whitespace-nowrap px-4 text-sm ${tab === t ? "text-fg" : "text-mute hover:text-fg"}`}>
            {t}{t === "Tasks" && <span className="ml-1.5 font-mono text-[10px] text-dim">{tasks.length}</span>}{t === "Memory" && <span className="ml-1.5 font-mono text-[10px] text-dim">{memories.length}</span>}{tab === t && <span className="absolute inset-x-0 -bottom-px h-px bg-amber" />}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "Overview" && (
          <div className="space-y-5">
            <Telemetry run={state.run} live={live} currentAction={currentAction} />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="panel p-5">
                <h2 className="label">Objective</h2><p className="t-body mt-2">{m.objective}</p>
                {m.successCriteria && <p className="t-secondary mt-2"><span className="text-dim">Success · </span>{m.successCriteria}</p>}
                <div className="mt-4 border-t border-line pt-3"><h2 className="label">Current Task</h2><p className="mt-1 break-words font-mono text-sm">{isActive(state.task?.status) ? state.task!.input : <span className="text-mute">{paused ? "Paused — no work accepted" : "Idle — awaiting task"}</span>}</p></div>
              </section>
              <section className="panel p-5" aria-label="Machine runtime">
                <div className="mb-3 flex items-center justify-between"><h2 className="label">Machine Runtime</h2><span className="t-caption">{state.run ? `RUN ${state.run.id.slice(0, 8)}` : "NO RUNS YET"}</span></div>
                <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">{STAGES.map(([label, hint], i) => { const cur = live && i === stage, done = i < stage; return (
                  <li key={label} aria-current={cur ? "step" : undefined} className={`border p-3 transition-colors duration-300 ${cur ? (runStatus === "waiting_approval" ? "border-warn bg-warn/5" : "border-amber bg-amber/5") : done ? "border-line" : "border-line/60"}`}>
                    <div className="flex items-center justify-between"><span className={`font-mono text-[11px] tracking-[.16em] ${cur ? (runStatus === "waiting_approval" ? "text-warn" : "text-amber") : done ? "text-fg" : "text-dim"}`}>{String(i + 1).padStart(2, "0")} {label}</span><span className="font-mono text-[10px]">{cur ? <span className="dot-live inline-block h-1.5 w-1.5 rounded-full bg-amber text-amber" /> : done ? <span className="text-ok">✓</span> : null}</span></div>
                    <div className="t-caption mt-1">{cur && runStatus === "waiting_approval" ? "Waiting for approval" : hint}</div>
                  </li>); })}</ol>
                <dl className="mt-4 grid grid-cols-3 gap-px border border-line bg-line font-mono text-[11px]">{[["TASKS", state.machine.tasksCompleted.toLocaleString()], ["SUCCESS", state.machine.tasksCompleted ? `${state.machine.successRate.toFixed(1)}%` : "—"], ["TOTAL COST", fmtUsd(state.machine.totalCost)]].map(([k, v]) => <div key={k} className="bg-bg3 p-2"><dt className="text-dim">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}</dl>
              </section>
            </div>
            {failed && state.run && <FailureBanner status={state.task!.status} error={state.run.error ?? state.task!.output} errorKind={state.run.errorKind} machineId={m.id} runId={state.run.id} onRetry={paused ? undefined : () => execute(state.task!.input)} />}
            <div className="grid gap-5 xl:grid-cols-2">
              <OutputPanel task={state.task} live={live} runId={state.run?.id} machineId={m.id} onNew={() => dialog.current?.showModal()} canRun={!paused && !live} onRunAgain={(i) => execute(i)} />
              <div className="space-y-3">
                <Terminal logs={state.logs} live={live} title={state.task?.number ? `TERMINAL · TASK #${state.task.number}` : "MACHINE TERMINAL"} onTool={setToolSel} selectedTool={toolSel} />
                {selectedTool && <ToolDetail t={selectedTool} onClose={() => setToolSel(null)} />}
              </div>
            </div>
          </div>
        )}

        {tab === "Tasks" && (tasks.length === 0 ? (
          <Empty title="NO TASKS YET" body="Assign this Machine its first task." cta={<button className="btn btn-primary mt-6" disabled={paused} onClick={() => dialog.current?.showModal()}>Run Task</button>} />
        ) : (
          <div className="border border-line">
            <div className="hidden grid-cols-[80px_minmax(0,1fr)_140px_90px_80px_80px_90px] gap-3 border-b border-line px-4 py-2 md:grid">{["Task", "Input", "Status", "Started", "Duration", "Cost", ""].map((h) => <span key={h} className="label">{h}</span>)}</div>
            <ul>{tasks.map((t) => (
              <li key={t.id} className={`grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-line/60 px-4 py-3 last:border-0 md:grid-cols-[80px_minmax(0,1fr)_140px_90px_80px_80px_90px] md:items-center ${taskId === t.id ? "bg-panel2" : ""}`}>
                <span className="font-mono text-xs text-dim">#{t.number}{t.source !== "operator" && <span className="ml-1 text-[9px] uppercase">{t.source}</span>}</span>
                <button onClick={() => { select(t.id); setTab("Overview"); }} className="order-3 col-span-2 truncate text-left text-sm hover:underline md:order-none md:col-span-1">{t.input}</button>
                <span className="justify-self-end md:justify-self-start"><Status s={statusChip(t.status)} />{t.status !== "completed" && !isActive(t.status) && t.status !== "failed" && <span className="ml-1 font-mono text-[9px] text-dim">{t.status.replace("_", " ").toUpperCase()}</span>}</span>
                <span className="order-4 font-mono text-[11px] text-mute md:order-none">{ago(t.startedAt ?? t.createdAt)}</span>
                <span className="order-5 font-mono text-[11px] md:order-none">{t.durationMs ? fmtDuration(t.durationMs) : "—"}</span>
                <span className="order-6 font-mono text-[11px] md:order-none">{fmtUsd(t.cost)}</span>
                <TaskRunLink machineId={m.id} taskId={t.id} />
              </li>))}</ul>
          </div>
        ))}

        {tab === "Memory" && <MemoryPanel machineId={m.id} memoryMode={m.memoryMode} memories={memories} onChanged={() => router.refresh()} limits={{ maxRuntimeSec: m.maxRuntimeSec, maxToolCalls: m.maxToolCalls, maxTurns: m.maxTurns, maxTaskCost: m.maxTaskCost }} />}
        {tab === "Tools" && <ToolsPanel machineId={m.id} tools={tools} perms={perms} customApis={customApis} onChanged={() => router.refresh()} />}
        {tab === "Logs" && <Terminal logs={state.logs} live={live} tall title={state.task?.number ? `RUN LOG · TASK #${state.task.number}` : "MACHINE LOG"} onTool={(id) => { setToolSel(id); setTab("Overview"); }} />}
        {tab === "Configuration" && <div id="configuration"><ConfigPanel m={m} perms={perms} onSaved={(msg) => { setNotice({ tone: "ok", msg }); router.refresh(); }} onError={(msg) => setNotice({ tone: "bad", msg })} /></div>}
      </div>
      <RunDialog ref={dialog} name={m.name} onExecute={execute} simulated={m.modelProvider === "mock"} />
    </div>
  );
}

const statusChip = (s: string) => (s === "completed" ? "completed" : s === "failed" || s === "timeout" ? "failed" : s === "cancelled" ? "offline" : s === "budget_exceeded" ? "paused" : s === "waiting_approval" ? "pending" : s === "queued" ? "queued" : "running");
function TaskRunLink({ machineId, taskId }: { machineId: string; taskId: string }) { return <Link href={`/app/machines/${machineId}/runs/task-${taskId}`} className="hidden font-mono text-[10px] tracking-widest text-mute hover:text-fg md:block">INSPECT →</Link>; }
function Empty({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) { return <div className="grid-bg flex flex-col items-center border border-dashed border-line px-6 py-14 text-center"><div className="t-section">{title}</div><p className="t-secondary mt-2 max-w-sm">{body}</p>{cta}</div>; }

function OutputPanel({ task, live, runId, machineId, onNew, canRun, onRunAgain }: { task: TaskDTO | null; live: boolean; runId?: string; machineId: string; onNew: () => void; canRun: boolean; onRunAgain: (i: string) => Promise<string | null> }) {
  if (!task) return <Empty title="NO TASKS YET" body="Assign this Machine its first task." cta={<button className="btn btn-primary mt-6" disabled={!canRun} onClick={onNew}>Run Task</button>} />;
  if (isActive(task.status)) return (
    <section className="panel flex min-h-[380px] flex-col p-5" aria-busy>
      <div className="flex items-center justify-between"><span className={`t-section ${task.status === "waiting_approval" ? "!text-warn" : "!text-proc"}`}>{task.status === "waiting_approval" ? "WAITING FOR APPROVAL" : "EXECUTING"}{task.number ? ` · TASK #${task.number}` : ""}</span><Status s={statusChip(task.status)} /></div>
      <p className="mt-3 break-words font-mono text-sm text-mute">{task.input}</p>
      <div className="mt-auto space-y-2 pt-6"><div className="relative h-px overflow-hidden bg-line"><span className="sweep absolute inset-y-0 w-1/3 bg-proc" /></div><div className="skeleton h-3 w-4/5" /><div className="skeleton h-3 w-3/5" /></div>
    </section>
  );
  const ok = task.status === "completed";
  return (
    <section className={`fade-up flex min-h-[380px] flex-col border ${ok ? "border-ok/30" : "border-bad/40"} bg-bg3`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-4 py-3">
        <span className={`t-section ${ok ? "!text-ok" : "!text-bad"}`}>{ok ? "TASK COMPLETE" : `TASK ${task.status.replace("_", " ").toUpperCase()}`}</span><span className="t-caption">#{task.number}</span>
        <span className="t-caption ml-auto">DURATION <span className="text-fg">{fmtDuration(task.durationMs)}</span></span><span className="t-caption">COST <span className="text-fg">{fmtUsd(task.cost)}</span></span>
      </div>
      <div className="flex-1 p-4">{task.result && ok ? <ResultView r={task.result} compact /> : <p className="font-mono text-sm text-fg/90">{task.output ?? "—"}</p>}</div>
      <div className="flex flex-wrap gap-2 border-t border-line p-3">
        {runId && <Link className="btn h-9" href={`/app/machines/${machineId}/runs/${runId}`}>Inspect Run</Link>}
        <button className="btn h-9" disabled={!canRun} onClick={() => onRunAgain(task.input)}>{ok ? "Run Again" : "Retry"}</button>
        <button className="btn btn-primary h-9" disabled={!canRun} onClick={onNew}>Create New Task</button>
      </div>
    </section>
  );
}

function RunDialog({ ref, name, onExecute, simulated }: { ref: React.RefObject<HTMLDialogElement | null>; name: string; onExecute: (input: string) => Promise<string | null>; simulated: boolean }) {
  const [input, setInput] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const close = () => { ref.current?.close(); setErr(""); };
  return (
    <dialog ref={ref} aria-labelledby="run-title" className="m-auto w-[min(560px,calc(100vw-2rem))] border border-line bg-bg3 p-0 text-fg backdrop:bg-black/75" onClose={() => setErr("")}>
      <form className="p-5 sm:p-6" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await onExecute(input); setBusy(false); if (r) setErr(r); else { setInput(""); close(); } }}>
        <div className="t-caption">{name}</div><h2 id="run-title" className="t-section mt-1 !text-base">RUN TASK</h2>
        <label htmlFor="task" className="t-secondary mt-4 block">Assign work to this Machine.</label>
        <textarea id="task" autoFocus rows={5} value={input} onChange={(e) => setInput(e.target.value)} className="input mt-2" placeholder="Find 5 recently launched AI infrastructure companies and identify why each one could matter." />
        {simulated && <p className="t-caption mt-2">MOCK RUNTIME — tools are simulated. Test hooks: [http-post] [call:NAME] [remember] [calc] [loop] [simulate-failure]</p>}
        {err && <p role="alert" className="mt-3 font-mono text-xs text-bad">{err}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy || input.trim().length < 3}>{busy ? "Queuing…" : "Execute"}</button></div>
      </form>
    </dialog>
  );
}

function MemoryPanel({ machineId, memoryMode, memories, onChanged, limits }: { machineId: string; memoryMode: string; memories: MemoryRow[]; onChanged: () => void; limits: { maxRuntimeSec: number; maxToolCalls: number; maxTurns: number; maxTaskCost: number } }) {
  const [q, setQ] = useState(""); const [f, setF] = useState<"recent" | "important" | "structured" | "pinned">("recent");
  const [edit, setEdit] = useState<MemoryRow | { id?: undefined; content: string; importance: number; kind: string } | null>(null);
  const [pending, start] = useTransition(); const [err, setErr] = useState("");
  const persistent = memoryMode === "persistent" || memoryMode === "structured";
  const list = useMemo(() => {
    let l = memories.filter((x) => x.content.toLowerCase().includes(q.toLowerCase()));
    if (f === "important") l = [...l].filter((x) => x.importance >= 4).sort((a, b) => b.importance - a.importance);
    if (f === "structured") l = l.filter((x) => x.kind === "entity" || x.kind === "pattern");
    if (f === "pinned") l = l.filter((x) => x.pinned);
    return l;
  }, [memories, q, f]);
  if (!persistent && !memories.length) return <Empty title="NO PERSISTENT MEMORY" body="This Machine does not retain information between Runs." cta={<button className="btn btn-primary mt-6" disabled={pending} onClick={() => start(async () => { const r = await updateMachineLimitsAction(machineId, { ...limits, memoryMode: "persistent" }); if (!r.ok) setErr(r.error); await setMachineToolAction(machineId, "remember", true); onChanged(); })}>Enable Memory</button>} />;
  return (
    <div className="space-y-3">
      {!persistent && <p className="border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">Memory mode is {memoryMode.toUpperCase()} — stored memories are not loaded into runs until you switch to Persistent.</p>}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex border border-line" role="tablist">{(["recent", "important", "structured", "pinned"] as const).map((x) => <button key={x} role="tab" aria-selected={f === x} onClick={() => setF(x)} className={`min-h-10 px-3 font-mono text-[11px] tracking-widest ${f === x ? "bg-fg text-bg" : "text-mute hover:text-fg"}`}>{x.toUpperCase()}</button>)}</div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memory" aria-label="Search memory" className="input h-10 md:ml-auto md:max-w-xs" />
        <button className="btn h-10" onClick={() => setEdit({ content: "", importance: 3, kind: "fact" })}>+ Add Memory</button>
      </div>
      {edit && (
        <form className="space-y-2 border border-line p-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveMemoryAction(machineId, { id: edit.id, content: edit.content, importance: edit.importance, kind: edit.kind }); if (!r.ok) setErr(r.error); else { setEdit(null); setErr(""); onChanged(); } }); }}>
          <label htmlFor="mem-content" className="label">{edit.id ? "Edit memory" : "New memory"}</label>
          <textarea id="mem-content" rows={3} className="input" value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} autoFocus />
          <div className="flex flex-wrap items-center gap-2"><select aria-label="Kind" className="input h-9 w-36 text-xs" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{["fact", "entity", "preference", "pattern"].map((k) => <option key={k}>{k}</option>)}</select>
            <label className="flex items-center gap-2 text-xs">Importance<input type="range" min={1} max={5} value={edit.importance} onChange={(e) => setEdit({ ...edit, importance: Number(e.target.value) })} className="accent-[#d9c9a8]" /><span className="font-mono">{edit.importance}</span></label>
            <span className="ml-auto flex gap-2"><button type="button" className="btn h-9" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary h-9" disabled={pending}>Save</button></span></div>
        </form>)}
      {err && <p role="alert" className="font-mono text-xs text-bad">{err}</p>}
      {!list.length ? <p className="t-secondary border border-dashed border-line p-6 text-center">{memories.length ? "No memories match this view." : "No memories yet. Memories appear when the Machine stores durable facts or you add them."}</p> : (
        <ul className="divide-y divide-line border border-line">{list.map((x) => (
          <li key={x.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0"><p className="text-sm">{x.pinned && <span className="mr-1 text-amber" aria-label="Pinned">◆</span>}{x.content}</p>
              <p className="t-caption mt-1">{x.kind.toUpperCase()} · IMPORTANCE {x.importance} · SOURCE {x.source.toUpperCase()} · USED {x.usedCount}× · {ago(x.createdAt)}</p></div>
            <div className="flex gap-1 self-start"><button className="btn h-8 px-2 text-[10px]" disabled={pending} onClick={() => start(async () => { await pinMemoryAction(machineId, x.id, !x.pinned); onChanged(); })}>{x.pinned ? "Unpin" : "Pin"}</button><button className="btn h-8 px-2 text-[10px]" onClick={() => setEdit(x)}>Edit</button><button className="btn btn-danger h-8 px-2 text-[10px]" disabled={pending} onClick={() => { if (confirm("Delete this memory?")) start(async () => { await deleteMemoryAction(machineId, x.id); onChanged(); }); }}>Delete</button></div>
          </li>))}</ul>)}
    </div>
  );
}

function ToolsPanel({ machineId, tools, perms, customApis, onChanged }: { machineId: string; tools: ToolRow[]; perms: Perm[]; customApis: { slug: string; name: string }[]; onChanged: () => void }) {
  const [pending, start] = useTransition(); const [err, setErr] = useState("");
  const [domains, setDomains] = useState(((tools.find((t) => t.tool === "http_request")?.config.allowedDomains as string[] | undefined) ?? []).join(", "));
  const enabled = (id: string) => !!tools.find((t) => t.tool === id && t.enabled);
  const mode = (p: string | null) => (p ? perms.find((x) => x.permission === p)?.mode ?? "DENY" : null);
  const toggle = (id: string, v: boolean, d?: string[]) => start(async () => { const r = await setMachineToolAction(machineId, id, v, d); if (!r.ok) setErr(r.error); else { setErr(""); onChanged(); } });
  const rows = [...TOOL_CATALOG, ...customApis.map((a) => ({ ...toolMeta(`api__${a.slug}`)!, id: `api__${a.slug}`, name: a.name }))];
  return (
    <div className="space-y-3">
      {!tools.some((t) => t.enabled) && <div className="border border-dashed border-line p-4"><div className="t-section">NO TOOLS ENABLED</div><p className="t-secondary mt-1">This Machine can reason but cannot interact with external systems. Enable tools below.</p></div>}
      {err && <p role="alert" className="font-mono text-xs text-bad">{err}</p>}
      <ul className="divide-y divide-line border border-line">{rows.map((t) => { const pm = mode(t.permission); const sandbox = t.status === "sandbox_required"; return (
        <li key={t.id} className={`p-3 ${sandbox ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm">{t.name}<span className="font-mono text-[9px] text-dim">{t.category}</span>{sandbox ? <span className="font-mono text-[9px] text-warn">SANDBOX REQUIRED</span> : t.permission ? <span className={`font-mono text-[9px] ${pm === "ALLOW" ? "text-ok" : pm === "ASK" ? "text-warn" : "text-bad"}`}>{t.permission} · {pm}</span> : null}</div><p className="t-secondary">{t.description}</p></div>
            <button type="button" role="switch" aria-checked={enabled(t.id)} aria-label={t.name} disabled={sandbox || pending} onClick={() => toggle(t.id, !enabled(t.id))} className={`relative h-6 w-11 shrink-0 border ${enabled(t.id) ? "border-ok bg-ok/15" : "border-line"}`}><span className={`absolute top-[3px] h-4 w-4 ${enabled(t.id) ? "left-[22px] bg-ok" : "left-[3px] bg-dim"}`} /></button>
          </div>
          {t.id === "http_request" && enabled(t.id) && <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); toggle("http_request", true, domains.split(",").map((x) => x.trim()).filter(Boolean)); }}><label htmlFor="dom" className="sr-only">Allowed domains</label><input id="dom" className="input h-9 font-mono text-xs" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="Allowed domains: api.example.com, httpbin.org" /><button className="btn h-9">Save</button></form>}
        </li>); })}</ul>
      <p className="t-caption">Tool availability is enforced server-side. A tool also needs its permission set to ASK or ALLOW in Configuration.</p>
    </div>
  );
}

function ConfigPanel({ m, perms, onSaved, onError }: { m: ConsoleMachine; perms: Perm[]; onSaved: (msg: string) => void; onError: (msg: string) => void }) {
  const [f, setF] = useState({ name: m.name, description: m.description, objective: m.objective, successCriteria: m.successCriteria, systemPrompt: m.systemPrompt, dailyBudget: m.dailyBudget, monthlyBudget: m.monthlyBudget });
  const [lim, setLim] = useState({ maxRuntimeSec: m.maxRuntimeSec, maxToolCalls: m.maxToolCalls, maxTurns: m.maxTurns, maxTaskCost: m.maxTaskCost, memoryMode: m.memoryMode });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === "number" ? +e.target.value : e.target.value });
  const permMode = (k: string) => perms.find((p) => p.permission === k)?.mode ?? "DENY";
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <form className="panel space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await updateMachineAction(m.id, f); if ("error" in r && r.error) onError(r.error); else onSaved("CONFIGURATION SAVED"); }); }}>
          <h2 className="t-section">IDENTITY & OBJECTIVE</h2>
          {([["name", "Machine Name"], ["description", "Description"]] as const).map(([k, l]) => <div key={k}><label htmlFor={`c-${k}`} className="label mb-1.5 block">{l}</label><input id={`c-${k}`} className={`input ${k === "name" ? "font-mono uppercase" : ""}`} value={f[k]} onChange={set(k)} /></div>)}
          <div><label htmlFor="c-obj" className="label mb-1.5 block">Objective</label><textarea id="c-obj" rows={3} className="input" value={f.objective} onChange={set("objective")} /></div>
          <div><label htmlFor="c-sys" className="label mb-1.5 block">System Instructions</label><textarea id="c-sys" rows={3} className="input font-mono text-xs" value={f.systemPrompt} onChange={set("systemPrompt")} /></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="c-db" className="label mb-1.5 block">Daily Budget ($)</label><input id="c-db" type="number" min={0} step={0.5} className="input font-mono" value={f.dailyBudget} onChange={set("dailyBudget")} /></div><div><label htmlFor="c-mb" className="label mb-1.5 block">Monthly Budget ($)</label><input id="c-mb" type="number" min={0} className="input font-mono" value={f.monthlyBudget} onChange={set("monthlyBudget")} /></div></div>
          <div className="flex justify-end border-t border-line pt-4"><button className="btn btn-primary" disabled={pending}>Save Configuration</button></div>
        </form>
        <form className="panel space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await updateMachineLimitsAction(m.id, lim); if (!r.ok) onError(r.error); else onSaved("RUNTIME LIMITS SAVED"); }); }}>
          <h2 className="t-section">RUNTIME LIMITS & MEMORY</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([["maxRuntimeSec", "Max runtime (s)"], ["maxToolCalls", "Max tool calls"], ["maxTurns", "Max AI turns"], ["maxTaskCost", "Max task cost ($)"]] as const).map(([k, l]) => <div key={k}><label htmlFor={`l-${k}`} className="label mb-1.5 block">{l}</label><input id={`l-${k}`} type="number" step={k === "maxTaskCost" ? 0.05 : 1} className="input font-mono" value={lim[k]} onChange={(e) => setLim({ ...lim, [k]: Number(e.target.value) })} /></div>)}</div>
          <div><label htmlFor="l-mem" className="label mb-1.5 block">Memory mode</label><select id="l-mem" className="input" value={lim.memoryMode} onChange={(e) => setLim({ ...lim, memoryMode: e.target.value })}>{MEMORY_MODES.map((x) => <option key={x.key} value={x.key}>{x.label} — {x.desc}</option>)}</select></div>
          <div className="flex justify-end border-t border-line pt-4"><button className="btn btn-primary" disabled={pending}>Save Limits</button></div>
        </form>
      </div>
      <section className="panel h-fit">
        <h2 className="t-section border-b border-line px-4 py-3">PERMISSION BOUNDARIES</h2>
        <ul>{PERMISSIONS.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
            <span className="min-w-0"><span className="block text-sm">{p.label}</span><span className={`font-mono text-[9px] ${p.risk === "low" ? "text-ok" : p.risk === "medium" ? "text-warn" : "text-bad"}`}>{p.risk.toUpperCase()} RISK</span></span>
            <span className="flex shrink-0" role="radiogroup" aria-label={p.label}>{(["DENY", "ASK", "ALLOW"] as PermissionMode[]).map((mo) => { const cur = permMode(p.key) === mo; return <button key={mo} role="radio" aria-checked={cur} disabled={pending} onClick={() => start(async () => { const r = await setPermissionModeAction(m.id, p.key, mo); if (!r.ok) onError(r.error); else onSaved(`${p.key} → ${mo}`); })} className={`h-8 w-14 border font-mono text-[10px] ${cur ? (mo === "ALLOW" ? "border-ok text-ok" : mo === "ASK" ? "border-warn text-warn" : "border-bad text-bad") : "border-line text-dim"}`}>{mo}</button>; })}</span>
          </li>))}</ul>
      </section>
    </div>
  );
}
