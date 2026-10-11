"use client";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { edgeTypes, nodeTypes, toRFEdges, toRFNodes } from "@/components/arcs/canvas-parts";
import type { Graph, MachineRef } from "@/lib/arcs/graph";
import type { RunNodeDTO } from "@/types/arc";

type Props = { graph: Graph; machines: MachineRef[]; runNodes?: RunNodeDTO[] | null; selected?: string | null; onSelect?: (key: string | null) => void; className?: string; controls?: boolean };

function Inner({ graph, machines, runNodes, selected, onSelect, controls = true }: Props) {
  const nodes = useMemo(() => toRFNodes(graph, machines, runNodes).map((n) => ({ ...n, selected: n.id === selected })), [graph, machines, runNodes, selected]);
  const edges = useMemo(() => toRFEdges(graph, runNodes), [graph, runNodes]);
  const rf = useReactFlow();
  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.18, duration: 0 }), 30); return () => clearTimeout(t); }, [graph, rf]);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
      onNodeClick={(_, n) => onSelect?.(n.id)} onPaneClick={() => onSelect?.(null)} fitView minZoom={0.2} maxZoom={1.6} colorMode="dark" proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} color="#2a2c2b" gap={20} size={1} />
      {controls && <Controls showInteractive={false} position="bottom-right" />}
    </ReactFlow>
  );
}

/** Read-only Arc canvas used for previews and run inspection. */
export default function ArcCanvasView(p: Props) {
  return <div className={`border border-line bg-[#0b0c0c] ${p.className ?? "h-[320px]"}`}><ReactFlowProvider><Inner {...p} /></ReactFlowProvider></div>;
}
