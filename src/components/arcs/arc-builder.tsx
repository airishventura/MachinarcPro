"use client";
/* eslint-disable react-hooks/refs -- the editor mirrors React Flow state into refs so debounced saves,
   undo/redo snapshots and keyboard handlers read the latest graph without re-subscribing every render. */
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, applyEdgeChanges, applyNodeChanges, useReactFlow, type Connection, type EdgeChange, type NodeChange } from "@xyflow/react";
import { deployArcAction, runArcAction, saveArcAction } from "@/app/arc-actions";
import { edgeState, edgeTypes, nodeTypes, toRFEdges, toRFNodes, type ArcRFEdge, type ArcRFNode } from "@/components/arcs/canvas-parts";
import { ArcInspector, type ArcSettings } from "@/components/arcs/arc-inspector";
import { RunPanel, runIsActive, useArcRun } from "@/components/arcs/run-monitor";
import { Status } from "@/components/ui";
import { autoLayout, connectionError, defaultNode, newKey, validateArc, type ArcNodeType, type Graph, type GraphNode, type MachineRef, type NodeConfig } from "@/lib/arcs/graph";
import { TYPE_LABEL } from "@/lib/domain";

type Snap = Graph;
type Props = { arc: { id: string; name: string; arcCode: string; description: string; objective: string; status: string; triggerType: string; viewport: { x: number; y: number; zoom: number } | null }; graph: Graph; machines: MachineRef[]; firstArc: boolean };
const GRID = 20;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const DND = "application/marc-node";

function subscribeGuide(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function guideCompleted() {
  try { return localStorage.getItem("marc-arc-guide") === "done"; } catch { return false; }
}
const serverGuideCompleted = () => true;

function LibItem({ label, sub, payload, onAdd, tone, readOnly }: { label: string; sub?: string; payload: object; onAdd: () => void; tone: string; readOnly: boolean }) {
  return (
    <li><button type="button" draggable={!readOnly} disabled={readOnly} onDragStart={(e) => { e.dataTransfer.setData(DND, JSON.stringify(payload)); e.dataTransfer.effectAllowed = "move"; }} onClick={onAdd} className="group flex w-full items-center gap-2 border border-transparent px-2 py-1.5 text-left hover:border-line hover:bg-panel disabled:opacity-40" title="Drag onto canvas or click to add">
      <span aria-hidden className={`h-3 w-[2px] ${tone}`} /><span className="min-w-0 flex-1"><span className="block truncate font-mono text-[11px] tracking-wider">{label}</span>{sub && <span className="block truncate font-mono text-[9.5px] text-dim">{sub}</span>}</span><span className="font-mono text-[10px] text-dim opacity-0 group-hover:opacity-100">+</span>
    </button></li>
  );
}

export default function ArcBuilder(p: Props) {
  return (
    <>
      <div className="border border-dashed border-line p-6 md:hidden">
        <div className="t-section">BUILDER NEEDS MORE SPACE</div>
        <p className="t-secondary mt-2">For the best editing experience, use a larger screen. You can still run this Arc and inspect its executions from the overview.</p>
        <Link href={`/app/arcs/${p.arc.id}`} className="btn btn-primary mt-4">Open Arc Overview</Link>
      </div>
      <div className="hidden md:block"><ReactFlowProvider><Editor {...p} /></ReactFlowProvider></div>
    </>
  );
}

function Editor({ arc, graph: g0, machines, firstArc }: Props) {
  const rf = useReactFlow<ArcRFNode, ArcRFEdge>();
  const wrap = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<ArcRFNode[]>(() => toRFNodes(g0, machines));
  const [edges, setEdges] = useState<ArcRFEdge[]>(() => toRFEdges(g0));
  const [settings, setSettingsState] = useState<ArcSettings>({ name: arc.name, description: arc.description, objective: arc.objective, triggerType: arc.triggerType });
  const [status, setStatus] = useState(arc.status);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "failed">("saved");
  const [toast, setToast] = useState<{ tone: "ok" | "bad" | "warn"; msg: string } | null>(null);
  const [panel, setPanel] = useState<"inspect" | "run">("inspect");
  const [runId, setRunId] = useState<string | null>(null);
  const [runSel, setRunSel] = useState<string | null>(null);
  const [showVal, setShowVal] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [busy, setBusy] = useState<null | "test" | "deploy">(null);
  const [guideVisible, setGuide] = useState(true);
  const savedGuideCompleted = useSyncExternalStore(subscribeGuide, guideCompleted, serverGuideCompleted);
  const guide = firstArc && guideVisible && !savedGuideCompleted;
  const [libQ, setLibQ] = useState("");
  const { state: run, refresh } = useArcRun(arc.id, runId);
  const running = runIsActive(run?.run.status);
  const readOnly = running;

  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const edgesRef = useRef(edges); edgesRef.current = edges;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const hist = useRef<{ past: Snap[]; future: Snap[]; lastKey: string; lastAt: number }>({ past: [], future: [], lastKey: "", lastAt: 0 });
  const saving = useRef(false);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

  const graphNow = useCallback((): Graph => ({
    nodes: nodesRef.current.map((n) => ({ ...n.data.gn, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
    edges: edgesRef.current.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
  }), []);
  const graph = useMemo(() => graphNow(), [nodes, edges, graphNow]); // eslint-disable-line react-hooks/exhaustive-deps

  const bump = useCallback(() => { setVersion((v) => v + 1); setSave("dirty"); }, []);
  const commit = useCallback((coalesceKey?: string) => {
    const h = hist.current;
    if (coalesceKey && h.lastKey === coalesceKey && Date.now() - h.lastAt < 1500) { h.lastAt = Date.now(); return; }
    h.past.push(graphNow()); if (h.past.length > 80) h.past.shift(); h.future = []; h.lastKey = coalesceKey ?? ""; h.lastAt = Date.now();
  }, [graphNow]);
  const restore = useCallback((s: Snap) => { setNodes(toRFNodes(s, machines)); setEdges(toRFEdges(s)); bump(); }, [machines, bump]);
  const undo = useCallback(() => { const h = hist.current; const prev = h.past.pop(); if (!prev) return; h.future.push(graphNow()); h.lastKey = ""; restore(prev); }, [graphNow, restore]);
  const redo = useCallback(() => { const h = hist.current; const nxt = h.future.pop(); if (!nxt) return; h.past.push(graphNow()); h.lastKey = ""; restore(nxt); }, [graphNow, restore]);

  // ---------- Persistence (debounced) ----------
  const doSave = useCallback(async () => {
    if (saving.current) return;
    saving.current = true; setSave("saving");
    const res = await saveArcAction(arc.id, graphNow(), settingsRef.current, rf.getViewport()).catch(() => ({ ok: false as const, error: "SAVE FAILED" }));
    saving.current = false;
    setSave((cur) => (res.ok ? (cur === "saving" ? "saved" : cur) : "failed"));
  }, [arc.id, graphNow, rf]);
  useEffect(() => {
    if (save !== "dirty" && save !== "failed") return;
    const t = setTimeout(doSave, save === "failed" ? 4000 : 900);
    return () => clearTimeout(t);
  }, [version, save, doSave]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (save !== "saved") e.preventDefault(); }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [save]);
  const flush = useCallback(async () => { if (save !== "saved") await doSave(); }, [save, doSave]);

  const setSettings = (s: ArcSettings) => { setSettingsState(s); bump(); };

  // ---------- Validation ----------
  const validation = useMemo(() => validateArc(graphNow(), machines), [version, machines, graphNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveRun = run?.run.id === runId ? run : null;
  const canvasNodes = useMemo(() => {
    const issues = new Map<string, "error" | "warn">();
    validation.checks.forEach((c) => { if (c.nodeKey && c.level !== "ok" && issues.get(c.nodeKey) !== "error") issues.set(c.nodeKey, c.level); });
    const by = new Map((liveRun?.nodes ?? []).map((r) => [r.key, r]));
    return nodes.map((n) => {
      const r = by.get(n.id); const v = r ? { status: r.status, branch: r.branch, startedAt: r.startedAt, durationMs: r.durationMs, detail: r.detail } : null;
      const c = n.data.run;
      const issue = issues.get(n.id) ?? null;
      return n.data.issue === issue && ((!c && !v) || (c && v && c.status === v.status && c.branch === v.branch && c.detail === v.detail && c.durationMs === v.durationMs && c.startedAt === v.startedAt)) ? n : { ...n, data: { ...n.data, issue, run: v } };
    });
  }, [nodes, validation, liveRun]);
  const canvasEdges = useMemo(() => {
    const by = new Map((liveRun?.nodes ?? []).map((r) => [r.key, r]));
    return edges.map((e) => { const state = liveRun ? edgeState({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null }, by) : "idle"; return e.data?.state === state ? e : { ...e, data: { state } }; });
  }, [edges, liveRun]);

  // ---------- Canvas handlers ----------
  const onNodesChange = useCallback((ch: NodeChange<ArcRFNode>[]) => {
    setNodes((ns) => applyNodeChanges(ch, ns));
    if (ch.some((c) => (c.type === "position" && c.dragging === false) || c.type === "remove")) bump();
  }, [bump]);
  const onEdgesChange = useCallback((ch: EdgeChange<ArcRFEdge>[]) => {
    setEdges((es) => applyEdgeChanges(ch, es));
    if (ch.some((c) => c.type === "remove")) bump();
  }, [bump]);
  const onConnect = useCallback((c: Connection) => {
    const err = connectionError(graphNow(), c.source, c.target, c.sourceHandle ?? null);
    if (err) { setToast({ tone: "bad", msg: err }); return; }
    commit();
    setEdges((es) => [...es, { id: `e_${Date.now().toString(36)}`, type: "arc", source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? "out", data: { state: "idle" } }]);
    bump();
  }, [graphNow, commit, bump]);

  const centerPos = useCallback(() => {
    const r = wrap.current?.getBoundingClientRect();
    const p = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    return { x: p.x - 106 + (nodesRef.current.length % 4) * 20, y: p.y - 40 + (nodesRef.current.length % 4) * 20 };
  }, [rf]);

  const addNode = useCallback((type: ArcNodeType, pos?: { x: number; y: number }, extra?: { machineId?: string; triggerKind?: NodeConfig["triggerKind"] }) => {
    if (readOnly) return;
    if (type === "trigger" && nodesRef.current.some((n) => n.data.gn.type === "trigger")) { setToast({ tone: "warn", msg: "Only one Trigger per Arc. Configure the existing Trigger instead." }); return; }
    const at = pos ?? centerPos();
    const m = machines.find((x) => x.id === extra?.machineId);
    const gn = defaultNode(type, snap(at.x), snap(at.y), m);
    if (type === "trigger" && extra?.triggerKind) { gn.config.triggerKind = extra.triggerKind; gn.label = `${extra.triggerKind.toUpperCase()} TRIGGER`; }
    const labels = new Set(nodesRef.current.map((n) => n.data.gn.label));
    if (labels.has(gn.label)) { let i = 2; while (labels.has(`${gn.label} ${i}`)) i++; gn.label = `${gn.label} ${i}`; }
    commit();
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...toRFNodes({ nodes: [gn], edges: [] }, machines)[0], selected: true }]);
    setSelNode(gn.key); setSelEdge(null); setPanel("inspect"); bump();
  }, [readOnly, centerPos, machines, commit, bump]);

  const updateNode = useCallback((key: string, patch: Partial<GraphNode> & { config?: NodeConfig }) => {
    commit(`upd:${key}`);
    setNodes((ns) => ns.map((n) => {
      if (n.id !== key) return n;
      const gn = { ...n.data.gn, ...patch, config: patch.config ?? n.data.gn.config };
      return { ...n, data: { ...n.data, gn, machine: machines.find((m) => m.id === gn.machineId) ?? null } };
    }));
    bump();
  }, [commit, bump, machines]);

  const deleteNode = useCallback((key: string) => { commit(); setNodes((ns) => ns.filter((n) => n.id !== key)); setEdges((es) => es.filter((e) => e.source !== key && e.target !== key)); setSelNode(null); bump(); }, [commit, bump]);
  const deleteEdge = useCallback((id: string) => { commit(); setEdges((es) => es.filter((e) => e.id !== id)); setSelEdge(null); bump(); }, [commit, bump]);
  const duplicate = useCallback((keys?: string[]) => {
    const ids = keys ?? nodesRef.current.filter((n) => n.selected).map((n) => n.id);
    const src = nodesRef.current.filter((n) => ids.includes(n.id) && n.data.gn.type !== "trigger");
    if (!src.length) return;
    commit();
    const copies = src.map((n) => { const gn: GraphNode = { ...n.data.gn, key: newKey(n.data.gn.type), label: `${n.data.gn.label} COPY`.slice(0, 60), x: snap(n.position.x + 40), y: snap(n.position.y + 60), config: { ...n.data.gn.config, alias: "" } }; return { ...toRFNodes({ nodes: [gn], edges: [] }, machines)[0], selected: true }; });
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...copies]);
    setSelNode(copies.length === 1 ? copies[0].id : null); bump();
  }, [commit, bump, machines]);
  const layout = useCallback(() => {
    commit();
    const laid = new Map(autoLayout(graphNow()).map((n) => [n.key, n]));
    setNodes((ns) => ns.map((n) => { const l = laid.get(n.id); return l ? { ...n, position: { x: l.x, y: l.y } } : n; }));
    bump(); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 60);
  }, [commit, graphNow, bump, rf]);

  // ---------- Keyboard ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
      const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
      if (mod && k === "s") { e.preventDefault(); doSave(); return; }
      if (typing || readOnly) { if (e.key === "Escape" && typing) (t as HTMLInputElement).blur(); return; }
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && k === "y") { e.preventDefault(); redo(); }
      else if (mod && k === "d") { e.preventDefault(); duplicate(); }
      else if (e.key === "Escape") { setSelNode(null); setSelEdge(null); setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n))); setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x))); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [doSave, undo, redo, duplicate, readOnly]);

  // ---------- Actions ----------
  const focusNode = (key?: string) => { if (!key) return; setSelNode(key); setSelEdge(null); setPanel("inspect"); setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === key }))); const n = nodesRef.current.find((x) => x.id === key); if (n) rf.setCenter(n.position.x + 106, n.position.y + 40, { zoom: 1, duration: 300 }); };
  const startTest = async () => {
    setBusy("test"); await flush();
    const res = await runArcAction(arc.id, testInput, { test: true });
    setBusy(null);
    if (!res.ok) { setToast({ tone: "bad", msg: res.error }); return; }
    setTestOpen(false); setRunId(res.runId); setRunSel(null); setPanel("run");
    if (guide) { localStorage.setItem("marc-arc-guide", "done"); }
  };
  const openTest = () => { if (!validation.valid) { setShowVal(true); setToast({ tone: "bad", msg: `ARC INVALID — ${validation.errors} issue${validation.errors > 1 ? "s" : ""} must be resolved before a test run.` }); return; } setTestOpen(true); };
  const deploy = async () => {
    if (!validation.valid) { setShowVal(true); setToast({ tone: "bad", msg: `ARC INVALID — ${validation.errors} issue${validation.errors > 1 ? "s" : ""} must be resolved before deployment.` }); return; }
    setBusy("deploy"); await flush();
    const res = await deployArcAction(arc.id);
    setBusy(null);
    if (!res.ok) { setToast({ tone: "bad", msg: res.error }); if (res.checks) setShowVal(true); return; }
    setStatus("deployed"); setToast({ tone: "ok", msg: `ARC DEPLOYED — ${settings.name} is now ready for execution.` });
  };

  const selected = graph.nodes.find((n) => n.key === selNode) ?? null;
  const selectedEdge = graph.edges.find((e) => e.id === selEdge) ?? null;
  const machineNodes = graph.nodes.filter((n) => n.type === "machine");
  const guideSteps = [
    { t: "ADD A MACHINE", d: "Drag a Machine onto the canvas.", done: machineNodes.length > 0 },
    { t: "CONNECT IT", d: "Connect nodes to define execution order.", done: machineNodes.some((m) => graph.edges.some((e) => e.target === m.key) && graph.edges.some((e) => e.source === m.key)) },
    { t: "TEST THE ARC", d: "Run your Arc before deployment.", done: !!runId },
  ];
  const libMachines = machines.filter((m) => `${m.name} ${m.machineCode} ${m.machineType}`.toLowerCase().includes(libQ.toLowerCase()));

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[560px] flex-col border border-line bg-bg2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><span className="truncate font-mono text-sm tracking-wider">{settings.name}</span><span className="t-caption hidden lg:inline">{arc.arcCode}</span></div>
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[10px] tracking-widest ${save === "failed" ? "text-bad" : save === "saved" ? "text-dim" : "text-proc"}`} aria-live="polite">{save === "saved" ? "SAVED" : save === "saving" ? "SAVING…" : save === "failed" ? "SAVE FAILED · RETRYING" : "UNSAVED"}</span>
            <Status s={running ? "running" : status === "deployed" ? "online" : status} />
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <TB label="Undo (⌘Z)" onClick={undo} disabled={readOnly || !hist.current.past.length}>↶</TB>
          <TB label="Redo (⌘⇧Z)" onClick={redo} disabled={readOnly || !hist.current.future.length}>↷</TB>
          <span className="mx-1 h-5 w-px bg-line" />
          <TB label="Zoom out" onClick={() => rf.zoomOut({ duration: 150 })}>−</TB>
          <TB label="Zoom in" onClick={() => rf.zoomIn({ duration: 150 })}>+</TB>
          <TB label="Fit view" onClick={() => rf.fitView({ padding: 0.2, duration: 250 })}>⤢</TB>
          <TB label="Auto-layout (left to right)" onClick={layout} disabled={readOnly}>AUTO-LAYOUT</TB>
          <span className="mx-1 h-5 w-px bg-line" />
          <button className={`btn h-8 px-3 ${validation.valid ? "" : "border-bad/50 text-bad"}`} onClick={() => setShowVal((v) => !v)} aria-expanded={showVal}>{validation.valid ? "Validate" : `${validation.errors} Issue${validation.errors > 1 ? "s" : ""}`}</button>
          <button className="btn h-8 px-3" onClick={openTest} disabled={running || busy !== null}>{running ? "Running…" : "Test Run"}</button>
          <button className="btn btn-primary h-8 px-3" onClick={deploy} disabled={busy !== null || running}>{busy === "deploy" ? "Deploying…" : status === "deployed" ? "Redeploy" : "Deploy"}</button>
          <details className="relative">
            <summary className="btn h-8 cursor-pointer list-none px-2" aria-label="More">⋯</summary>
            <div className="absolute right-0 z-20 mt-1 w-48 border border-line bg-bg3 py-1 text-sm shadow-xl">
              <Link href={`/app/arcs/${arc.id}`} className="block px-3 py-1.5 hover:bg-panel">Arc overview</Link>
              <Link href={`/app/arcs/${arc.id}?tab=runs`} className="block px-3 py-1.5 hover:bg-panel">Run history</Link>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-panel" onClick={() => duplicate()}>Duplicate selection</button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-panel" onClick={() => doSave()}>Save now (⌘S)</button>
            </div>
          </details>
        </div>
      </div>

      {guide && (
        <ol className="flex flex-wrap items-stretch gap-px border-b border-line bg-line text-xs" aria-label="First Arc guide">
          {guideSteps.map((s, i) => (
            <li key={s.t} className={`flex flex-1 items-center gap-3 bg-bg3 px-3 py-2 ${s.done ? "opacity-60" : ""}`}><span className={`font-mono ${s.done ? "text-ok" : "text-amber"}`}>{s.done ? "✓" : i + 1}</span><span><span className="block font-mono tracking-widest">{s.t}</span><span className="text-mute">{s.d}</span></span></li>
          ))}
          <li className="flex items-center bg-bg3 px-3"><button className="t-caption hover:text-fg" onClick={() => { localStorage.setItem("marc-arc-guide", "done"); setGuide(false); }}>DISMISS</button></li>
        </ol>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[176px_minmax(0,1fr)_272px] xl:grid-cols-[216px_minmax(0,1fr)_340px]">
        {/* Library */}
        <aside className="min-h-0 overflow-y-auto border-r border-line p-2" aria-label="Node library">
          <Group title="TRIGGERS"><ul>
            <LibItem readOnly={readOnly} label="MANUAL TRIGGER" payload={{ type: "trigger", triggerKind: "manual" }} onAdd={() => addNode("trigger", undefined, { triggerKind: "manual" })} tone="bg-proc" />
            <LibItem readOnly={readOnly} label="SCHEDULE TRIGGER" sub="runs via Automation" payload={{ type: "trigger", triggerKind: "schedule" }} onAdd={() => addNode("trigger", undefined, { triggerKind: "schedule" })} tone="bg-proc" />
            <LibItem readOnly={readOnly} label="WEBHOOK TRIGGER" sub="runs via Automation" payload={{ type: "trigger", triggerKind: "webhook" }} onAdd={() => addNode("trigger", undefined, { triggerKind: "webhook" })} tone="bg-proc" />
          </ul></Group>
          <Group title={`MACHINES · ${machines.length}`}>
            <input type="search" value={libQ} onChange={(e) => setLibQ(e.target.value)} placeholder="Search Machines" aria-label="Search Machines" className="input mb-1 h-8 px-2 text-xs" />
            <ul>
              {libMachines.map((m) => <LibItem readOnly={readOnly} key={m.id} label={m.name} sub={`${TYPE_LABEL[m.machineType] ?? m.machineType} · ${m.status.toUpperCase()} · ${m.machineCode}`} payload={{ type: "machine", machineId: m.id }} onAdd={() => addNode("machine", undefined, { machineId: m.id })} tone={m.status === "paused" ? "bg-warn" : "bg-fg"} />)}
              {!machines.length && <li className="t-caption px-2 py-2">No Machines yet. <Link href="/app/machines/new" className="underline">Create one</Link>.</li>}
            </ul>
          </Group>
          <Group title="LOGIC"><ul>
            <LibItem readOnly={readOnly} label="DECISION" sub="TRUE / FALSE branch" payload={{ type: "decision" }} onAdd={() => addNode("decision")} tone="bg-amber" />
            <LibItem readOnly={readOnly} label="DELAY" sub="wait, then continue" payload={{ type: "delay" }} onAdd={() => addNode("delay")} tone="bg-mute" />
            <LibItem readOnly={readOnly} label="HUMAN REVIEW" sub="operator approval" payload={{ type: "human_review" }} onAdd={() => addNode("human_review")} tone="bg-warn" />
          </ul></Group>
          <Group title="OUTPUT"><ul><LibItem readOnly={readOnly} label="FINAL OUTPUT" payload={{ type: "output" }} onAdd={() => addNode("output")} tone="bg-ok" /></ul></Group>
        </aside>

        {/* Canvas */}
        <div ref={wrap} className="relative min-h-0" onDragOver={(e) => { if (e.dataTransfer.types.includes(DND)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
          onDrop={(e) => { const raw = e.dataTransfer.getData(DND); if (!raw) return; e.preventDefault(); const d = JSON.parse(raw); const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); addNode(d.type, { x: pos.x - 106, y: pos.y - 30 }, d); }}>
          <ReactFlow<ArcRFNode, ArcRFEdge> nodes={canvasNodes} edges={canvasEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeDragStart={() => commit()} onBeforeDelete={async () => { if (readOnly) return false; commit(); return true; }}
            onSelectionChange={({ nodes: ns, edges: es }) => { setSelNode(ns.length === 1 ? ns[0].id : null); setSelEdge(!ns.length && es.length === 1 ? es[0].id : null); if (ns.length === 1 && running) setRunSel(ns[0].id); }}
            isValidConnection={(c) => c.source !== c.target}
            nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable
            snapToGrid snapGrid={[GRID, GRID]} deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]} multiSelectionKeyCode={["Meta", "Control", "Shift"]}
            defaultViewport={arc.viewport ?? undefined} fitView={!arc.viewport} fitViewOptions={{ padding: 0.2 }} minZoom={0.15} maxZoom={1.8}
            colorMode="dark" proOptions={{ hideAttribution: true }} onlyRenderVisibleElements>
            <Background variant={BackgroundVariant.Lines} color="#151717" gap={GRID} />
            <Background id="major" variant={BackgroundVariant.Lines} color="#1c1e1e" gap={GRID * 5} />
            <MiniMap pannable zoomable position="bottom-left" className="!m-2 !hidden !h-[90px] !w-[140px] !border !border-line !bg-bg xl:!block" maskColor="rgba(9,9,9,0.75)" nodeColor="#3a3c3b" nodeStrokeWidth={0} />
          </ReactFlow>
          {readOnly && <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 border border-proc/40 bg-bg/90 px-3 py-1 font-mono text-[10px] tracking-widest text-proc">TEST RUN IN PROGRESS · EDITING LOCKED</div>}
          {graph.nodes.length <= 2 && !machineNodes.length && !readOnly && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 mx-auto w-fit border border-dashed border-line bg-bg/80 px-4 py-2 text-center"><div className="t-section">PLACE MACHINES</div><div className="t-caption mt-0.5">Drag Machines from the library, then connect TRIGGER → MACHINES → OUTPUT</div></div>
          )}
          {showVal && (
            <section className="absolute right-2 top-2 z-10 max-h-[70%] w-[min(380px,90%)] overflow-y-auto border border-line bg-bg3 shadow-2xl" aria-label="Arc validation">
              <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="t-section">ARC VALIDATION</span><button className="t-caption hover:text-fg" onClick={() => setShowVal(false)} aria-label="Close validation">✕</button></div>
              <p className={`px-3 pt-2 font-mono text-[11px] ${validation.valid ? "text-ok" : "text-bad"}`}>{validation.valid ? `READY · ${validation.warnings} warning${validation.warnings === 1 ? "" : "s"}` : `${validation.errors} issue${validation.errors > 1 ? "s" : ""} must be resolved before deployment.`}</p>
              <ul className="space-y-1 p-3">{[...validation.checks].sort((a, b) => ({ error: 0, warn: 1, ok: 2 })[a.level] - ({ error: 0, warn: 1, ok: 2 })[b.level]).map((c, i) => (
                <li key={i}><button disabled={!c.nodeKey} onClick={() => focusNode(c.nodeKey)} className="flex w-full gap-2 text-left text-xs enabled:hover:text-fg">
                  <span className={`w-3 shrink-0 font-mono ${c.level === "ok" ? "text-ok" : c.level === "warn" ? "text-warn" : "text-bad"}`}>{c.level === "ok" ? "✓" : c.level === "warn" ? "⚠" : "✕"}</span><span className={c.level === "ok" ? "text-mute" : ""}>{c.message}</span>
                </button></li>))}</ul>
            </section>
          )}
          {toast && <div role="status" className={`fade-up absolute bottom-3 left-1/2 z-20 max-w-[90%] -translate-x-1/2 border bg-bg3 px-3 py-2 font-mono text-[11px] tracking-wider ${toast.tone === "ok" ? "border-ok/50 text-ok" : toast.tone === "warn" ? "border-warn/50 text-warn" : "border-bad/50 text-bad"}`}>{toast.msg}</div>}
        </div>

        {/* Right panel */}
        <aside className="flex min-h-0 flex-col border-l border-line" aria-label="Inspector">
          <div className="flex border-b border-line" role="tablist">
            {(["inspect", "run"] as const).map((t) => <button key={t} role="tab" aria-selected={panel === t} onClick={() => setPanel(t)} disabled={t === "run" && !runId} className={`relative flex-1 py-2 font-mono text-[10px] tracking-[.16em] disabled:opacity-40 ${panel === t ? "text-fg" : "text-mute hover:text-fg"}`}>{t === "inspect" ? "INSPECTOR" : <>RUN {running && <span className="dot-live ml-1 inline-block h-1.5 w-1.5 rounded-full bg-proc" />}</>}{panel === t && <span className="absolute inset-x-0 -bottom-px h-px bg-amber" />}</button>)}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {panel === "inspect" || !runId ? (
              <ArcInspector graph={graph} node={selected} edge={selectedEdge} machines={machines} settings={settings} readOnly={readOnly} onSettings={setSettings} onUpdate={updateNode} onDelete={deleteNode} onDuplicate={(k) => duplicate([k])} onDeleteEdge={deleteEdge} />
            ) : run ? (
              <RunPanel state={run} arcId={arc.id} selected={runSel} onSelect={(k) => { setRunSel(k); if (k) setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === k }))); }} onRefresh={refresh} compact onRetried={(id) => { setRunId(id); setRunSel(null); }} />
            ) : <div className="space-y-2"><div className="skeleton h-5 w-32" /><div className="skeleton h-20" /><div className="skeleton h-40" /></div>}
          </div>
          {runId && run && !running && panel === "run" && (
            <div className="flex gap-2 border-t border-line p-2"><Link className="btn h-8 flex-1" href={`/app/arcs/${arc.id}/runs/${runId}`}>Full Trace</Link><button className="btn h-8 flex-1" onClick={() => { setRunId(null); setPanel("inspect"); }}>Close Run</button></div>
          )}
        </aside>
      </div>

      {testOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal aria-labelledby="test-title" onKeyDown={(e) => e.key === "Escape" && setTestOpen(false)}>
          <div className="absolute inset-0 bg-black/75" onClick={() => setTestOpen(false)} />
          <form className="fade-up relative w-full max-w-lg border border-line bg-bg3 p-5" onSubmit={(e) => { e.preventDefault(); startTest(); }}>
            <div className="t-caption">{settings.name} · TEST RUN</div>
            <h2 id="test-title" className="t-section mt-1 !text-base">TRIGGER INPUT</h2>
            <p className="t-secondary mt-1">Runs the current saved configuration without deploying. Available to nodes as <span className="font-mono text-fg">{"{{trigger.input}}"}</span>.</p>
            <label htmlFor="test-input" className="sr-only">Trigger input</label>
            <textarea id="test-input" autoFocus rows={4} className="input mt-3" value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder="Analyze this topic: “Emerging decentralized AI infrastructure projects.”" />
            <p className="t-caption mt-2">Test hooks for Mock Runtime: [high-confidence] · [low-confidence] · [simulate-failure]</p>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setTestOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!testInput.trim() || busy === "test"}>{busy === "test" ? "Starting…" : "Start Test Run"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function TB({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className="h-8 min-w-8 border border-line px-2 font-mono text-[11px] tracking-wider text-mute hover:border-mute hover:text-fg disabled:opacity-35">{children}</button>;
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mb-3"><div className="label mb-1 px-1 !text-[9.5px] !text-dim">{title}</div>{children}</div>;
}
