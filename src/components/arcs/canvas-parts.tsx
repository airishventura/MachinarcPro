"use client";
import { memo, useEffect, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, Handle, Position, getSmoothStepPath, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { HANDLE_LABEL, NODE_META, OPERATORS, delaySeconds, type Graph, type GraphEdge, type GraphNode, type MachineRef } from "@/lib/arcs/graph";
import { TYPE_LABEL } from "@/lib/domain";

export type NodeRunView = { status: string; branch: string | null; startedAt: string | null; durationMs: number; detail: string | null };
export type ArcNodeData = { gn: GraphNode; machine?: MachineRef | null; run?: NodeRunView | null; issue?: "error" | "warn" | null };
export type ArcRFNode = Node<ArcNodeData, "arc">;
export type EdgeState = "idle" | "active" | "taken" | "skipped";
export type ArcRFEdge = Edge<{ state: EdgeState }, "arc">;

const TAG: Record<string, string> = { trigger: "TRIGGER", machine: "MACHINE", decision: "DECISION", human_review: "REVIEW", delay: "DELAY", output: "OUTPUT" };
const RUN_STYLE: Record<string, { frame: string; text: string; label: string }> = {
  pending: { frame: "border-line", text: "text-dim", label: "PENDING" },
  queued: { frame: "border-line", text: "text-proc", label: "QUEUED" },
  running: { frame: "border-proc shadow-[0_0_0_1px_#6a9fd8]", text: "text-proc", label: "EXECUTING" },
  waiting: { frame: "border-warn shadow-[0_0_0_1px_#d4a24c]", text: "text-warn", label: "WAITING" },
  completed: { frame: "border-ok/70", text: "text-ok", label: "COMPLETED" },
  failed: { frame: "border-bad shadow-[0_0_0_1px_#e0605a]", text: "text-bad", label: "FAILED" },
  skipped: { frame: "border-line border-dashed opacity-45", text: "text-dim", label: "SKIPPED" },
};
const ACCENT: Record<string, string> = { trigger: "bg-proc", machine: "bg-fg", decision: "bg-amber", human_review: "bg-warn", delay: "bg-mute", output: "bg-ok" };

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return <span className="tabular-nums">{String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}</span>;
}

function subtitle(gn: GraphNode, m?: MachineRef | null) {
  switch (gn.type) {
    case "trigger": return gn.config.triggerKind === "manual" || !gn.config.triggerKind ? "Runs when operator presses Run Arc" : `${gn.config.triggerKind.toUpperCase()} · configured in Automation`;
    case "machine": return m ? `${m.machineCode} · ${TYPE_LABEL[m.machineType] ?? m.machineType}` : gn.machineId ? "MACHINE UNAVAILABLE" : "Select a Machine";
    case "decision": { const op = OPERATORS.find((o) => o.key === gn.config.operator); const f = (gn.config.field ?? "").replace(/[{}]/g, "").split(".").slice(-1)[0]; return f ? `IF ${f} ${op?.symbol ?? "?"} ${["exists", "not_exists"].includes(gn.config.operator ?? "") ? "" : gn.config.value ?? ""}` : "Condition not set"; }
    case "human_review": return gn.config.title || "Operator approval";
    case "delay": return `WAIT ${delaySeconds(gn.config)}s`;
    case "output": return gn.config.outputName || "Arc result";
  }
}

export const ArcNodeView = memo(function ArcNodeView({ data, selected }: NodeProps<ArcRFNode>) {
  const { gn, machine, run, issue } = data;
  const rs = run ? RUN_STYLE[run.status] ?? RUN_STYLE.pending : null;
  const handles = NODE_META[gn.type].handles;
  const unavailable = gn.type === "machine" && gn.machineId && !machine;
  return (
    <div className={`relative w-[212px] border bg-[#101111] transition-[border-color,box-shadow,opacity] duration-300 ${rs ? rs.frame : unavailable ? "border-bad/70" : "border-line"} ${selected ? "outline outline-1 outline-offset-2 outline-amber" : ""}`} aria-label={`${TAG[gn.type]} ${gn.label}${run ? ` ${rs?.label}` : ""}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[2px] ${ACCENT[gn.type]}`} />
      {gn.type !== "trigger" && <Handle type="target" position={Position.Left} className="!-left-[5px]" />}
      <div className="flex items-center justify-between border-b border-line/70 px-2.5 py-1">
        <span className="font-mono text-[9px] tracking-[.18em] text-dim">{TAG[gn.type]}</span>
        <span className={`flex items-center gap-1 font-mono text-[9px] tracking-wider ${rs ? rs.text : machine ? (machine.status === "paused" ? "text-warn" : "text-dim") : "text-dim"}`}>
          {issue && !run && <span className={issue === "error" ? "text-bad" : "text-warn"} title={issue === "error" ? "Has validation errors" : "Has warnings"}>{issue === "error" ? "✕" : "!"}</span>}
          {run ? <>{run.status === "running" && <span className="dot-live inline-block h-1 w-1 rounded-full bg-proc" />}{rs?.label}{run.branch && HANDLE_LABEL[run.branch] ? ` · ${HANDLE_LABEL[run.branch]}` : ""}</> : machine ? machine.status.toUpperCase() : null}
        </span>
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate font-mono text-[12.5px] tracking-wider text-fg">{gn.label}</div>
        <div className={`mt-0.5 truncate font-mono text-[10px] ${unavailable ? "text-bad" : "text-mute"}`}>{subtitle(gn, machine)}</div>
        {gn.type === "machine" && gn.config.alias && <div className="mt-1 truncate font-mono text-[9.5px] text-dim">OUT → {gn.config.alias}</div>}
        {run?.status === "running" && (
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line/60 pt-1.5 font-mono text-[10px] text-proc">
            <span className="truncate text-mute">{run.detail ?? "Working…"}</span>{run.startedAt && <Elapsed since={run.startedAt} />}
          </div>
        )}
        {run && run.status === "completed" && run.durationMs > 0 && gn.type !== "trigger" && <div className="mt-1 font-mono text-[9.5px] text-dim">{(run.durationMs / 1000).toFixed(1)}s</div>}
      </div>
      {handles.length === 1 && <Handle type="source" id={handles[0]} position={Position.Right} className="!-right-[5px]" />}
      {handles.length === 2 && handles.map((h, i) => (
        <div key={h}>
          <Handle type="source" id={h} position={Position.Right} style={{ top: `${i === 0 ? 38 : 74}%` }} className="!-right-[5px]" />
          <span className={`pointer-events-none absolute right-2 font-mono text-[8.5px] tracking-widest ${h === "true" || h === "approve" ? "text-ok" : "text-bad"}`} style={{ top: `calc(${i === 0 ? 38 : 74}% - 6px)` }}>{HANDLE_LABEL[h]}</span>
        </div>
      ))}
    </div>
  );
});

export const ArcEdgeView = memo(function ArcEdgeView(p: EdgeProps<ArcRFEdge>) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX: p.sourceX, sourceY: p.sourceY, sourcePosition: p.sourcePosition, targetX: p.targetX, targetY: p.targetY, targetPosition: p.targetPosition, borderRadius: 6, offset: 18 });
  const st = p.data?.state ?? "idle";
  const stroke = st === "active" ? "#6a9fd8" : st === "taken" ? "#8d908e" : st === "skipped" ? "#2e302f" : p.selected ? "#d9c9a8" : "#454847";
  const label = p.sourceHandleId ? HANDLE_LABEL[p.sourceHandleId] : undefined;
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} style={{ stroke, strokeWidth: st === "active" || p.selected ? 1.6 : 1.2, strokeDasharray: st === "skipped" ? "4 4" : undefined, transition: "stroke .3s" }} />
      {st === "active" && <circle r="2.6" fill="#6a9fd8" className="edge-pulse"><animateMotion dur="1.4s" repeatCount="indefinite" path={path} /></circle>}
      {label && (
        <EdgeLabelRenderer>
          <div style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} className={`nodrag nopan pointer-events-none absolute border bg-bg px-1 font-mono text-[9px] tracking-widest ${st === "skipped" ? "border-line/50 text-dim" : p.sourceHandleId === "true" || p.sourceHandleId === "approve" ? "border-ok/40 text-ok" : "border-bad/40 text-bad"}`}>{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const nodeTypes = { arc: ArcNodeView };
export const edgeTypes = { arc: ArcEdgeView };

type RunLite = { key: string; status: string; branch: string | null; startedAt: string | null; durationMs: number; detail: string | null };

export function edgeState(e: GraphEdge, by: Map<string, RunLite>): EdgeState {
  const s = by.get(e.source), t = by.get(e.target);
  if (!s || !t) return "idle";
  const srcDone = s.status === "completed" || s.status === "failed";
  if (!srcDone) return s.status === "skipped" ? "skipped" : "idle";
  const active = s.status === "completed" ? !s.branch || s.branch === "out" || (e.sourceHandle ?? "out") === s.branch : false;
  if (!active && s.status === "completed") return "skipped";
  if (t.status === "running" || t.status === "queued") return "active";
  if (t.status === "skipped") return "skipped";
  return t.status === "pending" ? "idle" : "taken";
}

export function toRFNodes(g: Graph, machines: MachineRef[], runNodes?: RunLite[] | null, issues?: Map<string, "error" | "warn">): ArcRFNode[] {
  const by = new Map((runNodes ?? []).map((r) => [r.key, r]));
  return g.nodes.map((n) => {
    const r = by.get(n.key);
    return { id: n.key, type: "arc", position: { x: n.x, y: n.y }, data: { gn: n, machine: machines.find((m) => m.id === n.machineId) ?? null, run: r ? { status: r.status, branch: r.branch, startedAt: r.startedAt, durationMs: r.durationMs, detail: r.detail } : null, issue: issues?.get(n.key) ?? null } };
  });
}

export function toRFEdges(g: Graph, runNodes?: RunLite[] | null): ArcRFEdge[] {
  const by = new Map((runNodes ?? []).map((r) => [r.key, r]));
  return g.edges.map((e) => ({ id: e.id, type: "arc", source: e.source, target: e.target, sourceHandle: e.sourceHandle, data: { state: runNodes ? edgeState(e, by) : "idle" } }));
}
