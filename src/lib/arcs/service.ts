import "server-only";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, arcEdges, arcNodes, arcRunEvents, arcRunNodes, arcRuns, arcs, machines } from "@/db/schema";
import { ARC_TEMPLATES } from "@/config/arc-templates";
import { NODE_META, OPERATORS, autoLayout, connectionError, defaultNode, type ArcNodeType, type Graph, type GraphEdge, type GraphNode, type NodeConfig } from "@/lib/arcs/graph";
import { createMachine } from "@/lib/machines/service";
import { machineCode } from "@/lib/domain";
import { RuntimeError } from "@/lib/runtime/machine-runtime";

export const TRIGGER_TYPES = ["manual", "schedule", "webhook", "event"] as const;
const TRIGGER_LABEL: Record<string, string> = { manual: "MANUAL TRIGGER", schedule: "SCHEDULE TRIGGER", webhook: "WEBHOOK TRIGGER", event: "EVENT TRIGGER" };

async function uniqueArcCode() {
  for (let i = 0; i < 8; i++) {
    const code = `MARC-ARC-${Math.floor(1000 + Math.random() * 9000)}`;
    const [hit] = await db.select({ id: arcs.id }).from(arcs).where(eq(arcs.arcCode, code));
    if (!hit) return code;
  }
  return `MARC-ARC-${Date.now().toString().slice(-6)}`;
}

export async function getArcForWorkspace(arcId: string, workspaceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(arcId)) return null;
  const [a] = await db.select().from(arcs).where(and(eq(arcs.id, arcId), eq(arcs.workspaceId, workspaceId), isNull(arcs.deletedAt)));
  return a ?? null;
}

export async function createArc(workspaceId: string, f: { name: string; description: string; objective: string; triggerType: string }) {
  const name = f.name.trim().toUpperCase();
  if (name.length < 3) throw new RuntimeError("Arc name must be at least 3 characters.");
  if (name.length > 60) throw new RuntimeError("Arc name must be 60 characters or fewer.");
  const triggerType = (TRIGGER_TYPES as readonly string[]).includes(f.triggerType) ? f.triggerType : "manual";
  const [arc] = await db.insert(arcs).values({ workspaceId, name, arcCode: await uniqueArcCode(), description: f.description.trim().slice(0, 300), objective: f.objective.trim().slice(0, 1000), triggerType, nodesCount: 2 }).returning();
  const trigger = { ...defaultNode("trigger", 0, 0), label: TRIGGER_LABEL[triggerType], config: { triggerKind: triggerType as NodeConfig["triggerKind"] } };
  const output = { ...defaultNode("output", 580, 0), config: { outputName: `${name} RESULT`, template: "" } };
  await saveGraph(arc.id, workspaceId, { nodes: [trigger, output], edges: [] });
  await db.insert(activities).values({ workspaceId, category: "arcs", actor: name, message: `Arc ${name} created.` });
  return arc;
}

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : undefined);

function sanitizeConfig(type: ArcNodeType, c: Record<string, unknown>): NodeConfig {
  const out: NodeConfig = {};
  if (type === "trigger") out.triggerKind = (TRIGGER_TYPES as readonly string[]).includes(String(c.triggerKind)) ? (c.triggerKind as NodeConfig["triggerKind"]) : "manual";
  if (type === "machine") {
    out.instruction = str(c.instruction); out.alias = str(c.alias, 40);
    out.onFailure = ["stop", "skip", "review"].includes(String(c.onFailure)) ? (c.onFailure as NodeConfig["onFailure"]) : "stop";
    out.retries = Math.max(0, Math.min(3, Number(c.retries) || 0));
  }
  if (type === "decision") { out.field = str(c.field, 300); out.operator = OPERATORS.some((o) => o.key === c.operator) ? (c.operator as NodeConfig["operator"]) : "eq"; out.value = str(c.value, 300); }
  if (type === "human_review") { out.title = str(c.title, 120); out.reason = str(c.reason, 1000); out.display = str(c.display); }
  if (type === "delay") { out.duration = Math.max(0, Number(c.duration) || 0); out.unit = ["seconds", "minutes", "hours"].includes(String(c.unit)) ? (c.unit as NodeConfig["unit"]) : "seconds"; }
  if (type === "output") { out.outputName = str(c.outputName, 120); out.template = str(c.template); }
  return out;
}

/** Persists a graph. Enforces workspace Machine ownership and structural rules server-side. */
export async function saveGraph(arcId: string, workspaceId: string, g: Graph, viewport?: { x: number; y: number; zoom: number }) {
  const owned = new Set((await db.select({ id: machines.id }).from(machines).where(eq(machines.workspaceId, workspaceId))).map((m) => m.id));
  const nodes: GraphNode[] = [];
  for (const n of g.nodes.slice(0, 200)) {
    if (!(n.type in NODE_META) || typeof n.key !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(n.key) || nodes.some((x) => x.key === n.key)) continue;
    nodes.push({ key: n.key, type: n.type, label: (str(n.label, 60) ?? "").trim() || NODE_META[n.type].label.toUpperCase(), machineId: n.type === "machine" && n.machineId && owned.has(n.machineId) ? n.machineId : null,
      x: Number.isFinite(n.x) ? n.x : 0, y: Number.isFinite(n.y) ? n.y : 0, config: sanitizeConfig(n.type, (n.config ?? {}) as Record<string, unknown>) });
  }
  const edges: GraphEdge[] = [];
  for (const e of g.edges.slice(0, 400)) {
    const s = nodes.find((n) => n.key === e.source);
    if (!s) continue;
    const handle = NODE_META[s.type].handles.includes(String(e.sourceHandle)) ? String(e.sourceHandle) : NODE_META[s.type].handles[0] ?? null;
    if (connectionError({ nodes, edges }, e.source, e.target, handle)) continue;
    edges.push({ id: String(e.id).slice(0, 60), source: e.source, target: e.target, sourceHandle: handle, label: str(e.label, 40) ?? null });
  }
  await db.transaction(async (tx) => {
    const keys = nodes.map((n) => n.key);
    if (keys.length) await tx.delete(arcNodes).where(and(eq(arcNodes.arcId, arcId), notInArray(arcNodes.nodeKey, keys)));
    else await tx.delete(arcNodes).where(eq(arcNodes.arcId, arcId));
    if (nodes.length) await tx.insert(arcNodes).values(nodes.map((n) => ({ arcId, nodeKey: n.key, nodeType: n.type, label: n.label, machineId: n.machineId, positionX: n.x, positionY: n.y, config: n.config })))
      .onConflictDoUpdate({ target: [arcNodes.arcId, arcNodes.nodeKey], set: { nodeType: sql`excluded.node_type`, label: sql`excluded.label`, machineId: sql`excluded.machine_id`, positionX: sql`excluded.position_x`, positionY: sql`excluded.position_y`, config: sql`excluded.config`, updatedAt: new Date() } });
    await tx.delete(arcEdges).where(eq(arcEdges.arcId, arcId));
    if (edges.length) await tx.insert(arcEdges).values(edges.map((e) => ({ arcId, edgeKey: e.id, sourceNodeKey: e.source, targetNodeKey: e.target, sourceHandle: e.sourceHandle, label: e.label ?? null })));
    await tx.update(arcs).set({ nodesCount: nodes.length, updatedAt: new Date(), ...(viewport ? { viewport } : {}) }).where(eq(arcs.id, arcId));
  });
  return { nodes: nodes.length, edges: edges.length };
}

/** Copies a template into the workspace, reusing same-named Machines or creating them. */
export async function instantiateTemplate(workspaceId: string, key: string, opts: { status?: "draft" | "deployed" } = {}) {
  const t = ARC_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new RuntimeError("Template not found.");
  const existing = await db.select().from(machines).where(eq(machines.workspaceId, workspaceId));
  const machineIds = new Map<string, string>();
  for (const n of t.nodes) {
    if (!n.machine || machineIds.has(n.machine.name)) continue;
    const found = existing.find((m) => m.name === n.machine!.name);
    if (found) { machineIds.set(n.machine.name, found.id); continue; }
    const m = await createMachine(workspaceId, { name: n.machine.name, machineType: n.machine.type, description: n.machine.description, machineCode: machineCode(n.machine.type), objective: n.machine.objective, systemPrompt: n.machine.systemPrompt }, "idle");
    machineIds.set(n.machine.name, m.id);
  }
  const [arc] = await db.insert(arcs).values({ workspaceId, name: t.name, arcCode: await uniqueArcCode(), description: t.description, objective: t.objective, status: opts.status ?? "draft", nodesCount: t.nodes.length }).returning();
  const graph: Graph = {
    nodes: t.nodes.map((n) => ({ key: n.key, type: n.type, label: n.label, machineId: n.machine ? machineIds.get(n.machine.name) ?? null : null, x: 0, y: 0, config: n.config ?? {} })),
    edges: t.edges.map(([s, tg, h], i) => ({ id: `e${i}_${s}_${tg}`, source: s, target: tg, sourceHandle: h ?? "out" })),
  };
  graph.nodes = autoLayout(graph);
  await saveGraph(arc.id, workspaceId, graph);
  await db.insert(activities).values({ workspaceId, category: "arcs", actor: t.name, message: `Arc ${t.name} created from template.` });
  return arc;
}

/** Fabricates realistic historical runs for the demo Arc (no runtime execution). */
export async function seedDemoRuns(arcId: string, workspaceId: string) {
  const [arc] = await db.select().from(arcs).where(eq(arcs.id, arcId));
  const { loadArcGraph } = await import("@/lib/arcs/runtime");
  const g = await loadArcGraph(arcId);
  const topics = ["Decentralized AI inference networks", "Edge GPU marketplaces", "Open-weight model hosting", "Vector database consolidation", "Agent-to-agent payment rails", "Synthetic data infrastructure"];
  let ok = 0, total = 0, cost = 0, dur = 0;
  for (let i = 0; i < topics.length; i++) {
    const start = new Date(Date.now() - (topics.length - i) * 5.3 * 3600_000);
    const high = i % 3 !== 1, failed = i === 2;
    const path: Record<string, { status: "completed" | "skipped" | "failed"; branch?: string }> = {
      trigger: { status: "completed", branch: "out" }, scout: { status: "completed", branch: "out" },
      researcher: failed ? { status: "failed" } : { status: "completed", branch: "out" },
      check: failed ? { status: "skipped" } : { status: "completed", branch: high ? "true" : "false" },
      review: failed || high ? { status: "skipped" } : { status: "completed", branch: "approve" },
      reporter: failed ? { status: "skipped" } : { status: "completed", branch: "out" },
      out: failed ? { status: "skipped" } : { status: "completed", branch: "out" }, discard: { status: "skipped" },
    };
    let t = start.getTime(); let runCost = 0;
    const conf = high ? (0.82 + Math.random() * 0.14).toFixed(2) : (0.58 + Math.random() * 0.15).toFixed(2);
    const [run] = await db.insert(arcRuns).values({ arcId, workspaceId, status: failed ? "failed" : "completed", triggerPayload: { input: topics[i] }, graphSnapshot: g, startedAt: start, estimatedCost: 0.128, createdAt: start, errorMessage: failed ? "Machine execution failed after 1 attempt — The intelligence provider did not respond." : null, failedNodeKey: failed ? "researcher" : null }).returning();
    const events: { arcRunId: string; nodeKey: string | null; type: string; message: string; createdAt: Date }[] = [{ arcRunId: run.id, nodeKey: null, type: "run", message: "ARC RUN CREATED", createdAt: new Date(t) }];
    const order = ["trigger", "scout", "researcher", "check", "review", "reporter", "out", "discard"];
    for (const key of order) {
      const n = g.nodes.find((x) => x.key === key)!; const p = path[key];
      const d = Math.round(n.type === "machine" ? 4200 + Math.random() * 3500 : n.type === "human_review" ? 95_000 : 40);
      const c = n.type === "machine" && p.status !== "skipped" ? 0.018 + Math.random() * 0.03 : 0;
      const text = n.type === "decision" ? (high ? "TRUE" : "FALSE") : n.type === "trigger" ? topics[i] : n.type === "output" ? `EMERGING TECH BRIEF\n\nExecutive summary for "${topics[i]}" — 3 high-signal companies identified.` : `SUMMARY\n${n.label} processed "${topics[i]}".\nCONFIDENCE: ${conf}`;
      if (p.status !== "skipped") { events.push({ arcRunId: run.id, nodeKey: key, type: "node", message: `${n.label} STARTED`, createdAt: new Date(t) }); t += d; runCost += c; }
      await db.insert(arcRunNodes).values({ arcRunId: run.id, nodeKey: key, nodeType: n.type, label: n.label, status: p.status, branch: p.branch ?? null, outputPayload: p.status === "completed" ? { text } : null, errorMessage: p.status === "failed" ? "Machine execution failed after 1 attempt." : null, startedAt: p.status === "skipped" ? null : new Date(t - d), completedAt: p.status === "skipped" ? null : new Date(t), durationMs: p.status === "skipped" ? 0 : Math.round(d), cost: c, attempts: n.type === "machine" && p.status !== "skipped" ? 1 : 0 });
      events.push({ arcRunId: run.id, nodeKey: key, type: p.status === "skipped" ? "skip" : n.type === "decision" ? "decision" : "node", message: p.status === "skipped" ? `${n.label} SKIPPED — branch not taken` : n.type === "decision" ? `${n.label} → ${high ? "TRUE" : "FALSE"} (${conf} ≥ 0.8)` : n.type === "human_review" ? `OPERATOR APPROVED ${n.label}` : `${n.label} ${p.status === "failed" ? "FAILED" : "COMPLETED"}`, createdAt: new Date(t) });
      if (failed && key === "researcher") break;
    }
    if (failed) for (const key of order.slice(3)) { const n = g.nodes.find((x) => x.key === key)!; await db.insert(arcRunNodes).values({ arcRunId: run.id, nodeKey: key, nodeType: n.type, label: n.label, status: "skipped" }).onConflictDoNothing(); }
    events.push({ arcRunId: run.id, nodeKey: null, type: "run", message: failed ? "ARC FAILED — Machine execution failed after 1 attempt." : "ARC COMPLETED", createdAt: new Date(t + 20) });
    await db.insert(arcRunEvents).values(events);
    const d = t - start.getTime();
    await db.update(arcRuns).set({ completedAt: new Date(t), durationMs: d, cost: runCost, finalOutput: failed ? null : `EMERGING TECH BRIEF\n\nExecutive summary for "${topics[i]}":\n1. Lattice Compute — developer adoption tripled\n2. Halcyon Inference — inference cost 40% below incumbents\n3. Vectorline — signed three hyperscaler partnerships` }).where(eq(arcRuns.id, run.id));
    total++; ok += failed ? 0 : 1; cost += runCost; dur += d;
  }
  await db.update(arcs).set({ runsCompleted: total, successfulRuns: ok, successRate: Math.round((ok / total) * 1000) / 10, totalCost: cost, totalDurationMs: dur, lastRunAt: new Date(Date.now() - 5.3 * 3600_000), lastRunStatus: "completed" }).where(eq(arcs.id, arc.id));
}
