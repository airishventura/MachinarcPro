// Pure Arc graph logic — shared by the visual builder (client) and ArcRuntime (server).

export type ArcNodeType = "trigger" | "machine" | "decision" | "human_review" | "delay" | "output";
export type Operator = "eq" | "neq" | "contains" | "gt" | "lt" | "gte" | "lte" | "exists" | "not_exists";
export type FailurePolicy = "stop" | "skip" | "review";

export type NodeConfig = {
  triggerKind?: "manual" | "schedule" | "webhook" | "event";
  instruction?: string; alias?: string; onFailure?: FailurePolicy; retries?: number;
  field?: string; operator?: Operator; value?: string;
  title?: string; reason?: string; display?: string;
  duration?: number; unit?: "seconds" | "minutes" | "hours";
  outputName?: string; template?: string;
};
export type GraphNode = { key: string; type: ArcNodeType; label: string; machineId: string | null; x: number; y: number; config: NodeConfig };
export type GraphEdge = { id: string; source: string; target: string; sourceHandle: string | null; label?: string | null };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type MachineRef = { id: string; name: string; machineCode: string; machineType: string; status: string };

export const NODE_META: Record<ArcNodeType, { label: string; category: string; handles: string[]; hint: string }> = {
  trigger: { label: "Trigger", category: "TRIGGERS", handles: ["out"], hint: "Starts an Arc Run." },
  machine: { label: "Machine", category: "MACHINES", handles: ["out"], hint: "Executes an existing Machine." },
  decision: { label: "Decision", category: "LOGIC", handles: ["true", "false"], hint: "Routes execution on a condition." },
  human_review: { label: "Human Review", category: "LOGIC", handles: ["approve", "reject"], hint: "Pauses until an operator decides." },
  delay: { label: "Delay", category: "LOGIC", handles: ["out"], hint: "Waits before continuing." },
  output: { label: "Final Output", category: "OUTPUT", handles: [], hint: "Defines the Arc result." },
};
export const HANDLE_LABEL: Record<string, string> = { true: "TRUE", false: "FALSE", approve: "APPROVE", reject: "REJECT" };
export const OPERATORS: { key: Operator; label: string; symbol: string }[] = [
  { key: "eq", label: "equals", symbol: "=" }, { key: "neq", label: "not equals", symbol: "≠" }, { key: "contains", label: "contains", symbol: "∋" },
  { key: "gt", label: "greater than", symbol: ">" }, { key: "lt", label: "less than", symbol: "<" }, { key: "gte", label: "greater than or equal", symbol: "≥" },
  { key: "lte", label: "less than or equal", symbol: "≤" }, { key: "exists", label: "exists", symbol: "∃" }, { key: "not_exists", label: "does not exist", symbol: "∄" },
];
export const MAX_DELAY_SECONDS = 3600;
export const delaySeconds = (c: NodeConfig) => Math.max(0, (c.duration ?? 0) * (c.unit === "hours" ? 3600 : c.unit === "minutes" ? 60 : 1));

export function newKey(type: ArcNodeType) {
  return `${type.slice(0, 3)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultNode(type: ArcNodeType, x: number, y: number, machine?: MachineRef): GraphNode {
  const base = { key: newKey(type), type, x, y, machineId: null as string | null };
  switch (type) {
    case "trigger": return { ...base, label: "MANUAL TRIGGER", config: { triggerKind: "manual" } };
    case "machine": return { ...base, label: machine?.name ?? "MACHINE", machineId: machine?.id ?? null, config: { instruction: "", onFailure: "stop", retries: 0 } };
    case "decision": return { ...base, label: "DECISION", config: { field: "", operator: "gte", value: "0.8" } };
    case "human_review": return { ...base, label: "HUMAN REVIEW", config: { title: "OPERATOR REVIEW REQUIRED", reason: "", display: "" } };
    case "delay": return { ...base, label: "DELAY", config: { duration: 10, unit: "seconds" } };
    case "output": return { ...base, label: "FINAL OUTPUT", config: { outputName: "ARC REPORT", template: "" } };
  }
}

// ---------- Structure ----------
export const refName = (n: GraphNode) => (n.config.alias?.trim() || n.label).trim();

export function children(edges: GraphEdge[], key: string) { return edges.filter((e) => e.source === key).map((e) => e.target); }
export function parents(edges: GraphEdge[], key: string) { return edges.filter((e) => e.target === key).map((e) => e.source); }

export function reaches(edges: GraphEdge[], from: string, to: string): boolean {
  const seen = new Set<string>(); const stack = [from];
  while (stack.length) { const k = stack.pop()!; if (k === to) return true; if (seen.has(k)) continue; seen.add(k); stack.push(...children(edges, k)); }
  return false;
}

export function ancestors(edges: GraphEdge[], key: string): Set<string> {
  const out = new Set<string>(); const stack = parents(edges, key);
  while (stack.length) { const k = stack.pop()!; if (out.has(k)) continue; out.add(k); stack.push(...parents(edges, k)); }
  return out;
}

/** Returns topological order, or null when the graph contains a cycle. */
export function topoOrder(g: Graph): string[] | null {
  const indeg = new Map(g.nodes.map((n) => [n.key, 0]));
  g.edges.forEach((e) => indeg.has(e.target) && indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1));
  const q = g.nodes.filter((n) => !indeg.get(n.key)).sort((a, b) => a.x - b.x || a.y - b.y).map((n) => n.key);
  const out: string[] = [];
  while (q.length) {
    const k = q.shift()!; out.push(k);
    for (const c of children(g.edges, k)) { indeg.set(c, (indeg.get(c) ?? 1) - 1); if (indeg.get(c) === 0) q.push(c); }
  }
  return out.length === g.nodes.length ? out : null;
}

/** Explains why a proposed connection is invalid, or returns null when allowed. */
export function connectionError(g: Graph, source: string, target: string, sourceHandle: string | null): string | null {
  const s = g.nodes.find((n) => n.key === source), t = g.nodes.find((n) => n.key === target);
  if (!s || !t) return "Unknown node.";
  if (source === target) return "A node cannot connect to itself.";
  if (t.type === "trigger") return "Triggers start an Arc — they cannot receive connections.";
  if (s.type === "output") return "Final Output ends the Arc — it has no outgoing connections.";
  if (g.edges.some((e) => e.source === source && e.target === target && (e.sourceHandle ?? "out") === (sourceHandle ?? "out"))) return "These nodes are already connected.";
  if (reaches(g.edges, target, source)) return "This connection would create a loop. Arcs must flow in one direction.";
  return null;
}

// ---------- Layout ----------
export function autoLayout(g: Graph): GraphNode[] {
  const order = topoOrder(g) ?? g.nodes.map((n) => n.key);
  const layer = new Map<string, number>();
  for (const k of order) layer.set(k, Math.max(0, ...parents(g.edges, k).map((p) => (layer.get(p) ?? 0) + 1)));
  const cols = new Map<number, GraphNode[]>();
  g.nodes.forEach((n) => { const l = layer.get(n.key) ?? 0; cols.set(l, [...(cols.get(l) ?? []), n]); });
  const pos = new Map<string, { x: number; y: number }>();
  [...cols.entries()].sort((a, b) => a[0] - b[0]).forEach(([l, ns]) => {
    // Order within a column by the average y of parents to reduce crossings.
    const avgY = (n: GraphNode) => { const ps = parents(g.edges, n.key).map((p) => pos.get(p)?.y ?? 0); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : n.y; };
    const sorted = [...ns].sort((a, b) => avgY(a) - avgY(b) || (HANDLE_RANK(g, a) - HANDLE_RANK(g, b)));
    sorted.forEach((n, i) => pos.set(n.key, { x: l * 290, y: (i - (sorted.length - 1) / 2) * 150 }));
  });
  return g.nodes.map((n) => ({ ...n, ...(pos.get(n.key) ?? { x: n.x, y: n.y }) }));
}
const HANDLE_RANK = (g: Graph, n: GraphNode) => { const e = g.edges.find((x) => x.target === n.key); return e?.sourceHandle === "false" || e?.sourceHandle === "reject" ? 1 : 0; };

// ---------- Variables ----------
export const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function parseRef(raw: string): { node: string; prop: string; field?: string } | null {
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  const field = parts.length > 2 ? parts.slice(2).join(".") : undefined;
  const prop = parts[1].trim();
  if (!["output", "status", "input"].includes(prop)) return null;
  return { node: parts[0].trim(), prop, field };
}

export function refsIn(text = ""): string[] { return [...text.matchAll(VAR_RE)].map((m) => m[1]); }

export function availableRefs(g: Graph, key: string): string[] {
  const anc = ancestors(g.edges, key);
  const out = ["trigger.input"];
  g.nodes.filter((n) => anc.has(n.key) && n.type !== "trigger").forEach((n) => { out.push(`${refName(n)}.output`); if (n.type !== "output") out.push(`${refName(n)}.status`); });
  return out;
}

/** Extracts a field from Machine output: JSON first, then "field: value" text. */
export function extractField(text: string | undefined, field: string): string | undefined {
  if (text === undefined) return undefined;
  try { const j = JSON.parse(text); const v = field.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), j); if (v !== undefined) return String(v); } catch { /* not JSON */ }
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`${esc}[ \\t]*[:=][ \\t]*(-?[0-9]+(?:\\.[0-9]+)?)`, "i"))
    ?? text.match(new RegExp(`${esc}[ \\t]*[:=][ \\t]*([^\\n,]+)`, "i"))
    ?? text.match(new RegExp(`${esc}[ \\t]+(-?[0-9]+(?:\\.[0-9]+)?)`, "i"));
  return m?.[1]?.trim();
}

export type RefContext = Record<string, { input?: string; output?: string; status?: string }>;

export function resolveRef(raw: string, ctx: RefContext): string | undefined {
  const r = parseRef(raw);
  if (!r) return undefined;
  const entry = ctx[r.node.toLowerCase()];
  if (!entry) return undefined;
  const base = r.prop === "status" ? entry.status : r.prop === "input" ? entry.input : entry.output;
  return r.field ? extractField(base, r.field) : base;
}

export function interpolate(template: string, ctx: RefContext): string {
  return template.replace(VAR_RE, (_, raw: string) => resolveRef(raw, ctx) ?? `[unresolved: ${raw}]`);
}

export function evaluateCondition(left: string | undefined, op: Operator, right: string): boolean {
  if (op === "exists") return left !== undefined && left !== "";
  if (op === "not_exists") return left === undefined || left === "";
  if (left === undefined) return false;
  const ln = Number(left), rn = Number(right), num = left.trim() !== "" && right.trim() !== "" && !isNaN(ln) && !isNaN(rn);
  switch (op) {
    case "eq": return num ? ln === rn : left.trim().toLowerCase() === right.trim().toLowerCase();
    case "neq": return num ? ln !== rn : left.trim().toLowerCase() !== right.trim().toLowerCase();
    case "contains": return left.toLowerCase().includes(right.toLowerCase());
    case "gt": return num && ln > rn;
    case "lt": return num && ln < rn;
    case "gte": return num && ln >= rn;
    case "lte": return num && ln <= rn;
  }
}

// ---------- Validation ----------
export type Check = { level: "ok" | "warn" | "error"; message: string; nodeKey?: string };

export function validateArc(g: Graph, machines: MachineRef[]): { valid: boolean; checks: Check[]; errors: number; warnings: number } {
  const checks: Check[] = [];
  const err = (message: string, nodeKey?: string) => checks.push({ level: "error", message, nodeKey });
  const warn = (message: string, nodeKey?: string) => checks.push({ level: "warn", message, nodeKey });
  const triggers = g.nodes.filter((n) => n.type === "trigger"), outputs = g.nodes.filter((n) => n.type === "output");

  if (!triggers.length) err("Add a Trigger node — every Arc needs a starting point.");
  else if (triggers.length > 1) err("Only one Trigger is allowed per Arc.", triggers[1].key);
  else checks.push({ level: "ok", message: "Trigger configured" });
  if (triggers[0] && g.edges.some((e) => e.target === triggers[0].key)) err("The Trigger cannot have incoming connections.", triggers[0].key);

  if (!outputs.length) err("Add a Final Output node to define the Arc result.");
  else checks.push({ level: "ok", message: `Output configured${outputs.length > 1 ? ` (${outputs.length})` : ""}` });

  const order = topoOrder(g);
  if (!order) err("The Arc contains a loop. Remove the connection that flows backwards.");

  if (triggers[0]) {
    const reach = new Set<string>([triggers[0].key]);
    const stack = [triggers[0].key];
    while (stack.length) for (const c of children(g.edges, stack.pop()!)) if (!reach.has(c)) { reach.add(c); stack.push(c); }
    const unreachable = g.nodes.filter((n) => !reach.has(n.key));
    unreachable.forEach((n) => err(`${n.label} is not connected to the execution path.`, n.key));
    if (!unreachable.length && g.nodes.length > 1) checks.push({ level: "ok", message: `${reach.size} nodes reachable` });
    if (outputs.length && !outputs.some((o) => reach.has(o.key))) err("No Final Output is reachable from the Trigger.");
  }

  const names = new Map<string, number>();
  g.nodes.forEach((n) => names.set(refName(n).toLowerCase(), (names.get(refName(n).toLowerCase()) ?? 0) + 1));

  for (const n of g.nodes) {
    if (!n.label.trim()) err("Every node needs a label.", n.key);
    if ((names.get(refName(n).toLowerCase()) ?? 0) > 1 && n.type !== "trigger") warn(`Two nodes share the name "${refName(n)}" — variable references may be ambiguous. Set an output alias.`, n.key);
    const outs = g.edges.filter((e) => e.source === n.key);
    if (n.type === "machine") {
      const m = machines.find((x) => x.id === n.machineId);
      if (!n.machineId) err(`${n.label}: select a Machine to execute.`, n.key);
      else if (!m) err(`MACHINE UNAVAILABLE — ${n.label} references a Machine that no longer exists. Replace it before deploying.`, n.key);
      else if (m.status === "paused") warn(`${m.name} is paused — this node will fail until the Machine is resumed.`, n.key);
      if (!n.config.instruction?.trim()) warn(`${n.label} has no task instruction — it will receive upstream output as-is.`, n.key);
    }
    if (n.type === "decision") {
      if (!n.config.field?.trim()) err(`${n.label}: choose a field to evaluate.`, n.key);
      if (!OPERATORS.some((o) => o.key === n.config.operator)) err(`${n.label}: choose an operator.`, n.key);
      if (!["exists", "not_exists"].includes(n.config.operator ?? "") && !(n.config.value ?? "").trim()) err(`${n.label}: enter a comparison value.`, n.key);
      if (!outs.some((e) => e.sourceHandle === "true")) warn(`${n.label}: TRUE branch is not connected — the run ends there.`, n.key);
      if (!outs.some((e) => e.sourceHandle === "false")) warn(`${n.label}: FALSE branch is not connected — the run ends there.`, n.key);
    }
    if (n.type === "human_review") {
      if (!outs.some((e) => e.sourceHandle === "approve")) warn(`${n.label}: approve path is not connected.`, n.key);
      const rej = outs.filter((e) => e.sourceHandle === "reject");
      if (!rej.length || !rej.some((e) => g.nodes.some((o) => o.type === "output" && (o.key === e.target || reaches(g.edges, e.target, o.key))))) warn(`${n.label}: rejection path ends without an Output.`, n.key);
    }
    if (n.type === "delay") {
      const s = delaySeconds(n.config);
      if (s <= 0) err(`${n.label}: duration must be greater than zero.`, n.key);
      if (s > MAX_DELAY_SECONDS) err(`${n.label}: delays are limited to 1 hour in this release.`, n.key);
    }
    if (n.type === "output" && !n.config.template?.trim()) warn(`${n.label}: no template — upstream output will be used.`, n.key);
    if (n.type !== "output" && n.type !== "decision" && n.type !== "human_review" && !outs.length && g.nodes.length > 1) warn(`${n.label} ends without reaching an Output.`, n.key);

    const texts = [n.config.instruction, n.config.field, n.config.display, n.config.template].filter(Boolean) as string[];
    const allowed = new Set(availableRefs(g, n.key).map((r) => r.toLowerCase().split(".")[0]));
    for (const raw of texts.flatMap(refsIn)) {
      const r = parseRef(raw);
      if (!r) err(`${n.label}: "{{${raw}}}" is not a valid reference. Use {{Node.output}}, {{Node.status}} or {{trigger.input}}.`, n.key);
      else if (!allowed.has(r.node.toLowerCase())) err(`${n.label}: "{{${raw}}}" refers to a node that does not run before it.`, n.key);
    }
  }
  if (order) checks.push({ level: "ok", message: "No loops detected" });
  const errors = checks.filter((c) => c.level === "error").length, warnings = checks.filter((c) => c.level === "warn").length;
  return { valid: errors === 0, checks, errors, warnings };
}
