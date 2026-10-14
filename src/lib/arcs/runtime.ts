import "server-only";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getJobContext } from "@/lib/runtime/job-context";
import { errorSummary, obs } from "@/lib/security/redact";
import { enqueue } from "@/lib/queue/queue";
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, arcApprovals, arcEdges, arcNodes, arcRunEvents, arcRunNodes, arcRuns, arcs, machineRuns, machineTasks, machines } from "@/db/schema";
import { MachineRuntime, RuntimeError, RuntimeLeaseLostError } from "@/lib/runtime/machine-runtime";
import { HANDLE_LABEL, MAX_DELAY_SECONDS, OPERATORS, delaySeconds, evaluateCondition, interpolate, refName, resolveRef, validateArc, type ArcNodeType, type Graph, type GraphEdge, type GraphNode, type MachineRef, type NodeConfig, type RefContext } from "@/lib/arcs/graph";

type Run = typeof arcRuns.$inferSelect;
type RunNode = typeof arcRunNodes.$inferSelect;
const TERMINAL = ["completed", "failed", "cancelled"] as const;
const RESOLVED = ["completed", "failed", "skipped"];
const LOCK_MS = 120_000;
const driverContext = new AsyncLocalStorage<{ runId: string; owner: string; controller: AbortController }>();

export const runCode = (n: number) => `RUN-${String(n).padStart(5, "0")}`;
export const isTerminal = (s: string) => (TERMINAL as readonly string[]).includes(s);

type RunWriter = Pick<typeof db, "select" | "insert" | "update">;

export async function loadArcGraph(arcId: string, writer: RunWriter = db): Promise<Graph> {
  const [ns, es] = await Promise.all([
    writer.select().from(arcNodes).where(eq(arcNodes.arcId, arcId)),
    writer.select().from(arcEdges).where(eq(arcEdges.arcId, arcId)),
  ]);
  return {
    nodes: ns.map((n) => ({ key: n.nodeKey, type: n.nodeType as ArcNodeType, label: n.label, machineId: n.machineId, x: n.positionX, y: n.positionY, config: n.config as NodeConfig })),
    edges: es.map((e) => ({ id: e.edgeKey, source: e.sourceNodeKey, target: e.targetNodeKey, sourceHandle: e.sourceHandle, label: e.label })),
  };
}

export async function workspaceMachines(workspaceId: string, writer: RunWriter = db): Promise<MachineRef[]> {
  return writer.select({ id: machines.id, name: machines.name, machineCode: machines.machineCode, machineType: machines.machineType, status: machines.status }).from(machines).where(eq(machines.workspaceId, workspaceId));
}

function edgeActive(e: GraphEdge, p: RunNode) {
  if (p.status === "completed") return !p.branch || p.branch === "out" || (e.sourceHandle ?? "out") === p.branch;
  return p.status === "failed" && !!p.outputPayload?.continued;
}

/**
 * ArcRuntime — orchestrates Machines across a directed acyclic graph.
 * Execution is durable: every node state is persisted, a row-level lock prevents duplicate
 * drivers, and paused states (approval / delay) resume from the database. `drive()` can be
 * moved to a queue worker without changes.
 */
export class ArcRuntime {
  private static ownedWhere(runId: string) {
    const driver = driverContext.getStore();
    return and(eq(arcRuns.id, runId), driver?.runId === runId ? and(eq(arcRuns.lockOwner, driver.owner), sql`${arcRuns.lockUntil} > (now() at time zone 'UTC')`) : undefined);
  }

  private static async assertOwned(runId: string) {
    const driver = driverContext.getStore();
    if (driver?.runId !== runId) return;
    if (driver.controller.signal.aborted || getJobContext()?.signal.aborted) throw new RuntimeLeaseLostError();
    const [owned] = await db.select({ id: arcRuns.id }).from(arcRuns).where(and(this.ownedWhere(runId), notInArray(arcRuns.status, [...TERMINAL])));
    if (!owned) { driver.controller.abort(new RuntimeLeaseLostError()); throw new RuntimeLeaseLostError(); }
  }

  private static nodeOwner(runId: string) {
    const driver = driverContext.getStore();
    return driver?.runId === runId ? sql`exists (select 1 from arc_runs where id = ${runId} and lock_owner = ${driver.owner} and lock_until > (now() at time zone 'UTC') and status not in ('completed','failed','cancelled'))` : undefined;
  }
  // ---------- Run lifecycle ----------
  static async createRun(arcId: string, workspaceId: string, input: string, opts: { isTest: boolean; source?: string; triggerDepth?: number }, writer: RunWriter = db) {
    const [arc] = await writer.select().from(arcs).where(and(eq(arcs.id, arcId), eq(arcs.workspaceId, workspaceId), isNull(arcs.deletedAt)));
    if (!arc) throw new RuntimeError("Arc not found.");
    if (arc.status === "paused" && !opts.isTest) throw new RuntimeError("ARC PAUSED — resume the Arc to start new runs.");
    if (arc.status === "disabled") throw new RuntimeError("This Arc is disabled.");
    if (arc.status === "draft" && !opts.isTest) throw new RuntimeError("Deploy the Arc before running it, or start a Test Run from the builder.");
    const [active] = await writer.select({ id: arcRuns.id }).from(arcRuns).where(and(eq(arcRuns.arcId, arcId), inArray(arcRuns.status, ["queued", "running"]))).limit(1);
    if (active) throw new RuntimeError("An Arc Run is already executing. Wait for it to finish before starting another.");

    const graph = await loadArcGraph(arcId, writer);
    const v = ArcRuntime.validateArc(graph, await workspaceMachines(workspaceId, writer));
    if (!v.valid) throw new RuntimeError(`ARC INVALID — ${v.errors} issue${v.errors > 1 ? "s" : ""} must be resolved before running.`);

    const machineNodes = graph.nodes.filter((n) => n.type === "machine").length;
    const [run] = await writer.insert(arcRuns).values({
      arcId, workspaceId, status: "queued", isTest: opts.isTest, source: opts.source ?? (opts.isTest ? "test" : "operator"), triggerDepth: opts.triggerDepth ?? 0, triggerPayload: { input }, graphSnapshot: graph,
      estimatedCost: Math.round(machineNodes * 0.032 * 10000) / 10000, startedAt: new Date(),
    }).returning();
    const idByKey = new Map((await writer.select({ id: arcNodes.id, key: arcNodes.nodeKey }).from(arcNodes).where(eq(arcNodes.arcId, arcId))).map((r) => [r.key, r.id]));
    await writer.insert(arcRunNodes).values(graph.nodes.map((n) => ({ arcRunId: run.id, arcNodeId: idByKey.get(n.key) ?? null, nodeKey: n.key, nodeType: n.type, label: n.label })));
    await writer.insert(arcRunEvents).values({ arcRunId: run.id, nodeKey: null, type: "run", message: `ARC RUN CREATED${opts.isTest ? " · TEST" : ""}` });
    await writer.insert(activities).values({ workspaceId, category: "arcs", actor: arc.name, message: `Arc Run ${runCode(run.number)} started${opts.isTest ? " (test)" : ""} · ${arc.name}.` });
    return run;
  }

  static validateArc(graph: Graph, ms: MachineRef[]) { return validateArc(graph, ms); }

  /** Advances a run as far as possible. Safe to call concurrently — only one driver holds the lock. */
  static async drive(runId: string, depth = 0): Promise<void> {
    if (depth > 6) return;
    const owner = randomUUID();
    const [locked] = await db.update(arcRuns).set({ lockUntil: new Date(Date.now() + LOCK_MS), lockOwner: owner })
      .where(and(eq(arcRuns.id, runId), or(isNull(arcRuns.lockUntil), lt(arcRuns.lockUntil, new Date())), notInArray(arcRuns.status, [...TERMINAL]))).returning();
    if (!locked) return;
    const controller = new AbortController();
    const jobSignal = getJobContext()?.signal;
    const abort = () => controller.abort(new RuntimeLeaseLostError());
    if (jobSignal?.aborted) abort();
    else jobSignal?.addEventListener("abort", abort, { once: true });
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void db.update(arcRuns).set({ lockUntil: new Date(Date.now() + LOCK_MS) })
        .where(and(eq(arcRuns.id, runId), eq(arcRuns.lockOwner, owner), sql`${arcRuns.lockUntil} > (now() at time zone 'UTC')`, notInArray(arcRuns.status, [...TERMINAL])))
        .returning({ id: arcRuns.id }).then(rows => { if (!rows.length) abort(); }).catch(abort).finally(() => { renewing = false; });
    }, 30_000);
    try {
      await driverContext.run({ runId, owner, controller }, () => this.loop(locked));
    } catch (e) {
      if (e instanceof RuntimeLeaseLostError || controller.signal.aborted) throw new RuntimeLeaseLostError();
      obs("arc.drive_failed", { runId, error: errorSummary(e) });
      await driverContext.run({ runId, owner, controller }, async () => {
        await this.assertOwned(runId);
        await this.failRun(runId, null, "The Arc runtime encountered an unexpected error.");
      });
    } finally {
      clearInterval(heartbeat);
      jobSignal?.removeEventListener("abort", abort);
      await db.update(arcRuns).set({ lockUntil: null, lockOwner: null }).where(and(eq(arcRuns.id, runId), eq(arcRuns.lockOwner, owner)));
    }
    if (await this.hasWork(runId)) await this.drive(runId, depth + 1);
  }

  private static async loop(run: Run) {
    await this.assertOwned(run.id);
    const graph = run.graphSnapshot as unknown as Graph;
    if (run.status === "queued" || run.status.startsWith("waiting")) await db.update(arcRuns).set({ status: "running" }).where(and(this.ownedWhere(run.id), notInArray(arcRuns.status, [...TERMINAL])));
    await this.recoverInterruptedNodes(run, graph);
    for (let i = 0; i < 500; i++) {
      const [cur] = await db.select().from(arcRuns).where(eq(arcRuns.id, run.id));
      if (!cur || isTerminal(cur.status)) return;
      await this.assertOwned(run.id);
      let rns = await this.runNodes(run.id);
      const due = rns.filter((r) => r.status === "waiting" && r.nodeType === "delay" && r.resumeAt && r.resumeAt <= new Date());
      for (const d of due) {
        await this.complete(run.id, d.nodeKey, { branch: "out", output: { text: this.upstreamText(graph, rns, d.nodeKey) }, t0: d.startedAt?.getTime() ?? Date.now() });
        await this.event(run.id, d.nodeKey, "node", `${d.label} ELAPSED`);
      }
      if (due.length) rns = await this.runNodes(run.id);
      const { toRun, toSkip } = this.resolveNextNodes(graph, rns);
      if (!toRun.length && !toSkip.length) break;
      for (const n of toSkip) {
        await db.update(arcRunNodes).set({ status: "skipped" }).where(and(eq(arcRunNodes.arcRunId, run.id), eq(arcRunNodes.nodeKey, n.key), this.nodeOwner(run.id)));
        await this.event(run.id, n.key, "skip", `${n.label} SKIPPED — branch not taken`);
      }
      if (toRun.length) {
        if (cur.status !== "running") await db.update(arcRuns).set({ status: "running" }).where(and(this.ownedWhere(run.id), notInArray(arcRuns.status, [...TERMINAL])));
        await Promise.all(toRun.map((n) => this.executeNode(cur, graph, n, rns)));
      }
    }
    await this.finalize(run.id);
  }

  /** Resume persisted children; never recreate a child whose external outcome is unknown. */
  private static async recoverInterruptedNodes(run: Run, graph: Graph) {
    for (const rn of await this.runNodes(run.id)) {
      if (rn.status !== "running" && !(rn.status === "waiting" && rn.nodeType === "machine")) continue;
      await this.assertOwned(run.id);
      const node = graph.nodes.find(n => n.key === rn.nodeKey);
      if (!node) { await this.failRun(run.id, rn.nodeKey, "Interrupted node is missing from the persisted graph."); return; }
      const where = and(eq(arcRunNodes.id, rn.id), this.nodeOwner(run.id));
      if (rn.nodeType === "machine") {
        const [child] = rn.machineRunId ? await db.select({ id: machineRuns.id, status: machineRuns.status }).from(machineRuns)
          .innerJoin(machines, eq(machines.id, machineRuns.machineId))
          .where(and(eq(machineRuns.id, rn.machineRunId), eq(machines.workspaceId, run.workspaceId))) : [];
        if (!child) {
          await this.failRun(run.id, rn.nodeKey, "MACHINE EXECUTION INTERRUPTED — no durable child run is linked. Review the interrupted action before starting another run.");
          return;
        }
        await db.update(arcRunNodes).set({ status: "waiting" }).where(where);
        if (["completed", "failed", "cancelled", "budget_exceeded", "timeout"].includes(child.status)) {
          await this.onMachineRunFinished(child.id);
          const [current] = await db.select({ status: arcRuns.status }).from(arcRuns).where(eq(arcRuns.id, run.id));
          if (!current || isTerminal(current.status)) return;
        } else if (child.status !== "waiting_approval") {
          await enqueue("machine.execute", { runId: child.id }, { workspaceId: run.workspaceId, dedupeKey: `machine:${child.id}` });
        }
      } else if (["trigger", "decision", "output", "delay"].includes(rn.nodeType)) {
        // These nodes compute or persist local state; no external tool action can have occurred.
        await db.update(arcRunNodes).set({ status: "pending" }).where(where);
      } else {
        const [approval] = await db.select({ id: arcApprovals.id }).from(arcApprovals).where(and(eq(arcApprovals.arcRunId, run.id), eq(arcApprovals.nodeKey, rn.nodeKey), eq(arcApprovals.status, "pending")));
        if (approval) await db.update(arcRunNodes).set({ status: "waiting" }).where(where);
        else { await this.failRun(run.id, rn.nodeKey, "REVIEW NODE INTERRUPTED — review its persisted approval state before starting another run."); return; }
      }
    }
  }

  /** Nodes whose parents are all resolved: run if any incoming edge is active, otherwise skip. */
  static resolveNextNodes(graph: Graph, rns: RunNode[]) {
    const by = new Map(rns.map((r) => [r.nodeKey, r]));
    const toRun: GraphNode[] = [], toSkip: GraphNode[] = [];
    for (const n of graph.nodes) {
      if (by.get(n.key)?.status !== "pending") continue;
      const inc = graph.edges.filter((e) => e.target === n.key);
      if (!inc.length) { (n.type === "trigger" ? toRun : toSkip).push(n); continue; }
      const ps = inc.map((e) => by.get(e.source));
      if (ps.some((p) => !p || !RESOLVED.includes(p.status))) continue;
      (inc.some((e) => edgeActive(e, by.get(e.source)!)) ? toRun : toSkip).push(n);
    }
    return { toRun, toSkip };
  }

  private static async hasWork(runId: string) {
    const [run] = await db.select().from(arcRuns).where(eq(arcRuns.id, runId));
    if (!run || isTerminal(run.status) || run.status === "waiting_approval") return false;
    const rns = await this.runNodes(runId);
    if (rns.some((r) => r.status === "waiting" && r.nodeType === "delay" && r.resumeAt && r.resumeAt <= new Date())) return true;
    const { toRun, toSkip } = this.resolveNextNodes(run.graphSnapshot as unknown as Graph, rns);
    return toRun.length + toSkip.length > 0;
  }

  /** Whether a polling client should nudge the runtime (elapsed delay or orphaned run). */
  static needsDrive(run: Run, rns: RunNode[]) {
    if (isTerminal(run.status) || run.status === "waiting_approval") return false;
    if (run.lockUntil && run.lockUntil > new Date()) return false;
    if (run.status === "waiting_delay") return rns.some((r) => r.status === "waiting" && r.resumeAt && r.resumeAt <= new Date());
    return true;
  }

  // ---------- Node execution ----------
  static async executeNode(run: Run, graph: Graph, node: GraphNode, rns: RunNode[]) {
    await this.assertOwned(run.id);
    const t0 = Date.now();
    await db.update(arcRunNodes).set({ status: "running", startedAt: new Date() }).where(and(eq(arcRunNodes.arcRunId, run.id), eq(arcRunNodes.nodeKey, node.key), this.nodeOwner(run.id)));
    if (node.type === "machine" || node.type === "output") await this.event(run.id, node.key, "start", `${node.label} STARTED`);
    try {
      switch (node.type) {
        case "trigger": {
          await this.complete(run.id, node.key, { branch: "out", output: { text: run.triggerPayload.input }, t0 });
          await this.event(run.id, node.key, "node", `${node.label} COMPLETED`);
          return;
        }
        case "machine": return await this.executeMachineNode(run, graph, node, rns, t0);
        case "decision": return await this.executeDecisionNode(run, graph, node, rns, t0);
        case "human_review": return await this.pauseForApproval(run, graph, node, rns);
        case "delay": {
          const secs = Math.min(MAX_DELAY_SECONDS, delaySeconds(node.config));
          await db.update(arcRunNodes).set({ status: "waiting", resumeAt: new Date(Date.now() + secs * 1000) }).where(and(eq(arcRunNodes.arcRunId, run.id), eq(arcRunNodes.nodeKey, node.key), this.nodeOwner(run.id)));
          await this.event(run.id, node.key, "wait", `${node.label} WAITING ${secs}s`);
          // In-process wake-up for short delays; polling clients and future workers also resume via needsDrive().
          await enqueue("arc.drive", { runId: run.id }, { workspaceId: run.workspaceId, runAt: new Date(Date.now() + secs * 1000 + 250), dedupeKey: `arc-delay:${run.id}:${node.key}` });
          return;
        }
        case "output": return await this.executeOutputNode(run, graph, node, rns, t0);
      }
    } catch (e) {
      if (e instanceof RuntimeLeaseLostError) throw e;
      obs("arc.node_failed", { runId: run.id, machineId: node.machineId, nodeKey: node.key, error: errorSummary(e) });
      await this.nodeFailure(run, node, "Unexpected node error.", {});
    }
  }

  static async executeMachineNode(run: Run, graph: Graph, node: GraphNode, rns: RunNode[], t0: number) {
    const ctx = this.context(graph, rns, run.triggerPayload.input);
    const upstream = this.upstreamText(graph, rns, node.key) || run.triggerPayload.input;
    const instruction = node.config.instruction?.trim() ? interpolate(node.config.instruction, ctx) : upstream;
    const where = and(eq(arcRunNodes.arcRunId, run.id), eq(arcRunNodes.nodeKey, node.key), this.nodeOwner(run.id));
    await db.update(arcRunNodes).set({ inputPayload: { text: instruction } }).where(where);
    // Server-side workspace enforcement: never trust the snapshot's machine id alone.
    const [m] = node.machineId ? await db.select().from(machines).where(and(eq(machines.id, node.machineId), eq(machines.workspaceId, run.workspaceId))) : [];
    if (!m) return this.nodeFailure(run, node, "MACHINE UNAVAILABLE — the referenced Machine no longer exists.", { text: instruction });
    const retries = Math.max(0, Math.min(3, node.config.retries ?? 0));
    const attempts: { attempt: number; status: string; taskId?: string; cost: number; error?: string }[] = [];
    let cost = 0;
    for (let a = 1; a <= retries + 1; a++) {
      await this.assertOwned(run.id);
      if (a > 1) await this.event(run.id, node.key, "retry", `${node.label} RETRY · ATTEMPT ${a}/${retries + 1}`);
      try {
        await this.assertOwned(run.id);
        const { rt, task, mrun } = await db.transaction(async tx => {
          // Hold the parent row while creating and associating the child, or roll everything back.
          const [parent] = await tx.select({ id: arcRuns.id }).from(arcRuns).where(and(this.ownedWhere(run.id), notInArray(arcRuns.status, [...TERMINAL]))).for("update");
          if (!parent || getJobContext()?.signal.aborted || driverContext.getStore()?.controller.signal.aborted) throw new RuntimeLeaseLostError();
          const rt = await MachineRuntime.load(m.id, run.workspaceId, tx);
          const { task, run: mrun } = await rt.createRun(instruction, "arc", { allowBusy: true }, tx);
          const [linked] = await tx.update(arcRunNodes).set({ machineTaskId: task.id, machineRunId: mrun.id, attempts: a }).where(where).returning({ id: arcRunNodes.id });
          if (!linked || getJobContext()?.signal.aborted || driverContext.getStore()?.controller.signal.aborted) throw new RuntimeLeaseLostError();
          return { rt, task, mrun };
        });
        await this.assertOwned(run.id);
        const res = await rt.execute(mrun.id, driverContext.getStore()?.controller.signal);
        await this.assertOwned(run.id);
        if (res.status === "completed") {
          cost += res.cost;
          attempts.push({ attempt: a, status: "completed", taskId: task.id, cost: res.cost });
          await this.complete(run.id, node.key, { branch: "out", input: { text: instruction }, output: { text: res.output, attempts }, cost, t0 });
          await this.event(run.id, node.key, "node", `${node.label} COMPLETED`);
          return;
        }
        if (res.status === "waiting_approval" || res.status === "busy") {
          // Machine paused mid-run for operator authorization: the Arc node waits; onMachineRunFinished resumes it.
          await db.update(arcRunNodes).set({ status: "waiting", outputPayload: { attempts, retries, attempt: a } }).where(where);
          await this.event(run.id, node.key, "wait", `${node.label} WAITING FOR OPERATOR AUTHORIZATION (tool call)`);
          await this.activity(run.workspaceId, node.label, `Arc Run ${runCode(run.number)} paused: ${node.label} requested operator authorization.`, "warning");
          return;
        }
        attempts.push({ attempt: a, status: res.status, taskId: task.id, cost: res.cost ?? 0, error: res.error });
        cost += res.cost ?? 0;
        if (res.status === "cancelled" || res.status === "budget_exceeded") break;
      } catch (e) {
        if (e instanceof RuntimeLeaseLostError) throw e;
        attempts.push({ attempt: a, status: "failed", cost: 0, error: e instanceof RuntimeError ? e.userMessage : "Machine could not start." });
      }
    }
    const last = attempts[attempts.length - 1]?.error;
    await this.nodeFailure(run, node, `Machine execution failed after ${attempts.length} attempt${attempts.length > 1 ? "s" : ""}${last ? ` — ${last}` : "."}`, { text: instruction }, attempts);
  }

  static async executeDecisionNode(run: Run, graph: Graph, node: GraphNode, rns: RunNode[], t0: number) {
    const ctx = this.context(graph, rns, run.triggerPayload.input);
    const raw = (node.config.field ?? "").replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, "");
    const left = resolveRef(raw, ctx);
    const op = node.config.operator ?? "eq", value = node.config.value ?? "";
    const result = evaluateCondition(left, op, value);
    const sym = OPERATORS.find((o) => o.key === op)?.symbol ?? op;
    const expr = `${raw} = ${left ?? "∅"} · ${sym} ${["exists", "not_exists"].includes(op) ? "" : value}`.trim();
    await this.complete(run.id, node.key, { branch: result ? "true" : "false", input: { text: expr }, output: { text: result ? "TRUE" : "FALSE", left: left ?? null, result }, t0 });
    await this.event(run.id, node.key, "decision", `${node.label} → ${result ? "TRUE" : "FALSE"} (${left ?? "∅"} ${sym} ${value})`);
  }

  static async pauseForApproval(run: Run, graph: Graph, node: GraphNode, rns: RunNode[]) {
    const ctx = this.context(graph, rns, run.triggerPayload.input);
    const data = node.config.display?.trim() ? interpolate(node.config.display, ctx) : this.upstreamText(graph, rns, node.key);
    await db.insert(arcApprovals).values({ workspaceId: run.workspaceId, arcRunId: run.id, nodeKey: node.key, kind: "review", title: node.config.title?.trim() || "OPERATOR REVIEW REQUIRED", reason: interpolate(node.config.reason ?? "", ctx), data });
    await db.update(arcRunNodes).set({ status: "waiting", inputPayload: { text: data } }).where(and(eq(arcRunNodes.arcRunId, run.id), eq(arcRunNodes.nodeKey, node.key), this.nodeOwner(run.id)));
    await this.event(run.id, node.key, "wait", `${node.label} WAITING FOR OPERATOR APPROVAL`);
    await this.activity(run.workspaceId, node.label, `Arc Run ${runCode(run.number)} paused for operator approval.`, "warning");
  }

  static async executeOutputNode(run: Run, graph: Graph, node: GraphNode, rns: RunNode[], t0: number) {
    const ctx = this.context(graph, rns, run.triggerPayload.input);
    const text = node.config.template?.trim() ? interpolate(node.config.template, ctx) : this.upstreamText(graph, rns, node.key);
    await this.complete(run.id, node.key, { branch: "out", output: { text, outputName: node.config.outputName || node.label }, t0 });
    await this.event(run.id, node.key, "node", `${node.label} COMPLETED`);
  }

  private static async nodeFailure(run: Run, node: GraphNode, reason: string, input: { text?: string }, attempts: unknown[] = []) {
    await this.assertOwned(run.id);
    const where = and(eq(arcRunNodes.arcRunId, run.id), eq(arcRunNodes.nodeKey, node.key), this.nodeOwner(run.id));
    const policy = node.type === "machine" ? node.config.onFailure ?? "stop" : "stop";
    if (policy === "skip") {
      await db.update(arcRunNodes).set({ status: "failed", errorMessage: reason, inputPayload: input, outputPayload: { text: "", continued: true, attempts }, completedAt: new Date() }).where(where);
      await this.event(run.id, node.key, "fail", `${node.label} FAILED — CONTINUING (on failure: skip node)`);
    } else if (policy === "review") {
      await db.update(arcRunNodes).set({ status: "waiting", errorMessage: reason, inputPayload: input, outputPayload: { attempts } }).where(where);
      await db.insert(arcApprovals).values({ workspaceId: run.workspaceId, arcRunId: run.id, nodeKey: node.key, kind: "failure", title: "MACHINE FAILURE — OPERATOR DECISION", reason: `${node.label}: ${reason}`, data: "Approve to continue the Arc without this node's output. Reject to stop the run." });
      await this.event(run.id, node.key, "wait", `${node.label} FAILED — SENT TO HUMAN REVIEW`);
    } else {
      await db.update(arcRunNodes).set({ status: "failed", errorMessage: reason, inputPayload: input, outputPayload: { attempts }, completedAt: new Date() }).where(where);
      await this.event(run.id, node.key, "fail", `${node.label} FAILED`);
      await this.failRun(run.id, node.key, reason);
    }
  }

  /** Called by MachineRuntime whenever a Machine run reaches a terminal state. Resumes Arc nodes that were waiting on it. */
  static async onMachineRunFinished(machineRunId: string) {
    const [rn] = await db.select().from(arcRunNodes).where(and(eq(arcRunNodes.machineRunId, machineRunId), eq(arcRunNodes.status, "waiting")));
    if (!rn) return; // the Arc driver is awaiting this run synchronously and will handle the outcome
    const [run] = await db.select().from(arcRuns).where(eq(arcRuns.id, rn.arcRunId));
    if (!run || isTerminal(run.status)) return;
    const graph = run.graphSnapshot as unknown as Graph;
    const node = graph.nodes.find((n) => n.key === rn.nodeKey);
    if (!node) return;
    const [mr] = await db.select().from(machineRuns).where(eq(machineRuns.id, machineRunId));
    const [task] = mr ? await db.select().from(machineTasks).where(eq(machineTasks.id, mr.taskId)) : [];
    const prev = (rn.outputPayload?.attempts as { attempt: number; status: string; taskId?: string; cost: number; error?: string }[] | undefined) ?? [];
    const t0 = rn.startedAt?.getTime() ?? Date.now();
    if (mr?.status === "completed" && task) {
      const attempts = [...prev, { attempt: rn.attempts, status: "completed", taskId: task.id, cost: mr.cost }];
      await this.complete(run.id, node.key, { branch: "out", input: { text: rn.inputPayload?.text }, output: { text: task.output ?? "", attempts }, cost: prev.reduce((a, x) => a + (x.cost ?? 0), 0) + mr.cost, t0 });
      await this.event(run.id, node.key, "node", `${node.label} COMPLETED`);
    } else {
      const attempts = [...prev, { attempt: rn.attempts, status: mr?.status ?? "failed", taskId: task?.id, cost: mr?.cost ?? 0, error: mr?.error ?? "Machine run failed." }];
      await this.nodeFailure(run, node, `Machine execution ${mr?.status === "cancelled" ? "was cancelled" : "failed"} — ${mr?.error ?? "unknown error"}`, { text: rn.inputPayload?.text }, attempts);
    }
    await db.update(arcRuns).set({ status: "running" }).where(and(this.ownedWhere(run.id), notInArray(arcRuns.status, [...TERMINAL])));
    await enqueue("arc.drive", { runId: run.id }, { workspaceId: run.workspaceId });
  }

  // ---------- Approvals ----------
  static async resumeApproval(approvalId: string, workspaceId: string, userId: string, approve: boolean) {
    const [ap] = await db.select().from(arcApprovals).where(and(eq(arcApprovals.id, approvalId), eq(arcApprovals.workspaceId, workspaceId)));
    if (!ap) throw new RuntimeError("Approval not found.");
    if (ap.status !== "pending") throw new RuntimeError("This approval has already been decided.");
    const [run] = await db.select().from(arcRuns).where(eq(arcRuns.id, ap.arcRunId));
    if (!run || isTerminal(run.status)) throw new RuntimeError("This Arc Run is no longer active.");
    const [claimed] = await db.update(arcApprovals).set({ status: approve ? "approved" : "rejected", decidedBy: userId, decidedAt: new Date() }).where(and(eq(arcApprovals.id, ap.id), eq(arcApprovals.status, "pending"))).returning();
    if (!claimed) throw new RuntimeError("This approval has already been decided.");
    const [rn] = await db.select().from(arcRunNodes).where(and(eq(arcRunNodes.arcRunId, run.id), eq(arcRunNodes.nodeKey, ap.nodeKey)));
    const where = and(eq(arcRunNodes.arcRunId, run.id), eq(arcRunNodes.nodeKey, ap.nodeKey));
    const verb = approve ? "APPROVED" : "REJECTED";
    if (ap.kind === "review") {
      await db.update(arcRunNodes).set({ status: "completed", branch: approve ? "approve" : "reject", outputPayload: { text: ap.data, decision: verb }, completedAt: new Date(), durationMs: rn?.startedAt ? Date.now() - rn.startedAt.getTime() : 0 }).where(where);
      await this.event(run.id, ap.nodeKey, "approval", `OPERATOR ${verb} ${rn?.label ?? "REVIEW"}`);
    } else if (approve) {
      await db.update(arcRunNodes).set({ status: "failed", outputPayload: { ...(rn?.outputPayload ?? {}), text: "", continued: true }, completedAt: new Date() }).where(where);
      await this.event(run.id, ap.nodeKey, "approval", `OPERATOR APPROVED CONTINUATION AFTER ${rn?.label ?? "NODE"} FAILURE`);
    } else {
      await db.update(arcRunNodes).set({ status: "failed", completedAt: new Date() }).where(where);
      await this.event(run.id, ap.nodeKey, "approval", `OPERATOR REJECTED — STOPPING RUN`);
      await this.failRun(run.id, ap.nodeKey, rn?.errorMessage ?? "Stopped by operator.");
      return run.id;
    }
    await this.activity(workspaceId, rn?.label ?? "ARC", `Operator ${approve ? "approved" : "rejected"} review node in ${runCode(run.number)}.`, approve ? "success" : "warning");
    await db.update(arcRuns).set({ status: "running" }).where(and(this.ownedWhere(run.id), notInArray(arcRuns.status, [...TERMINAL])));
    return run.id;
  }

  // ---------- Completion ----------
  static async finalize(runId: string) {
    const [run] = await db.select().from(arcRuns).where(eq(arcRuns.id, runId));
    if (!run || isTerminal(run.status)) return;
    await this.assertOwned(runId);
    const rns = await this.runNodes(runId);
    const waiting = rns.filter((r) => r.status === "waiting");
    if (waiting.length) {
      await db.update(arcRuns).set({ status: waiting.some((w) => w.nodeType !== "delay") ? "waiting_approval" : "waiting_delay" }).where(and(this.ownedWhere(runId), notInArray(arcRuns.status, [...TERMINAL])));
      return;
    }
    if (rns.some((r) => ["pending", "queued", "running"].includes(r.status))) return;
    await this.completeRun(run, rns);
  }

  static async completeRun(run: Run, rns: RunNode[]) {
    await this.assertOwned(run.id);
    const outs = rns.filter((r) => r.nodeType === "output" && r.status === "completed");
    const finalOutput = outs.length ? outs.map((o) => `${String(o.outputPayload?.outputName ?? o.label)}\n\n${o.outputPayload?.text ?? ""}`).join("\n\n────────\n\n") : "No Output node was reached on the executed path.";
    const cost = rns.reduce((a, r) => a + r.cost, 0);
    const durationMs = Date.now() - (run.startedAt?.getTime() ?? Date.now());
    const [done] = await db.update(arcRuns).set({ status: "completed", finalOutput, cost, durationMs, completedAt: new Date() }).where(and(this.ownedWhere(run.id), notInArray(arcRuns.status, [...TERMINAL]))).returning();
    if (!done) return;
    await this.bumpArc(run.arcId, true, cost, durationMs);
    await this.event(run.id, null, "run", "ARC COMPLETED");
    await this.emitArc(done, "completed", finalOutput);
    await this.activity(run.workspaceId, "ARC", `Arc Run ${runCode(run.number)} completed successfully.`, "success");
  }

  static async failRun(runId: string, nodeKey: string | null, reason: string) {
    const [cur] = await db.select().from(arcRuns).where(eq(arcRuns.id, runId));
    if (!cur || isTerminal(cur.status)) return;
    await this.assertOwned(runId);
    const rns = await this.runNodes(runId);
    const cost = rns.reduce((a, r) => a + r.cost, 0);
    const durationMs = Date.now() - (cur.startedAt?.getTime() ?? Date.now());
    const [run] = await db.update(arcRuns).set({ status: "failed", errorMessage: reason, failedNodeKey: nodeKey, cost, durationMs, completedAt: new Date() }).where(and(this.ownedWhere(runId), notInArray(arcRuns.status, [...TERMINAL]))).returning();
    if (!run) return;
    await db.update(arcRunNodes).set({ status: "skipped" }).where(and(eq(arcRunNodes.arcRunId, runId), inArray(arcRunNodes.status, ["pending", "queued", "waiting"])));
    await db.update(arcApprovals).set({ status: "cancelled" }).where(and(eq(arcApprovals.arcRunId, runId), eq(arcApprovals.status, "pending")));
    await this.bumpArc(run.arcId, false, cost, durationMs);
    await this.event(runId, nodeKey, "run", `ARC FAILED — ${reason}`);
    await this.emitArc(run, "failed", reason);
    await this.activity(run.workspaceId, "ARC", `Arc Run ${runCode(run.number)} failed${nodeKey ? ` at ${rns.find((r) => r.nodeKey === nodeKey)?.label ?? nodeKey}` : ""}.`, "critical");
  }

  static async cancelRun(runId: string, workspaceId: string) {
    const [run] = await db.update(arcRuns).set({ status: "cancelled", completedAt: new Date(), errorMessage: "Cancelled by operator." }).where(and(eq(arcRuns.id, runId), eq(arcRuns.workspaceId, workspaceId), notInArray(arcRuns.status, [...TERMINAL]))).returning();
    if (!run) throw new RuntimeError("This Arc Run is no longer active.");
    const waitingMachines = await db.select({ mr: arcRunNodes.machineRunId }).from(arcRunNodes).where(and(eq(arcRunNodes.arcRunId, runId), inArray(arcRunNodes.status, ["running", "waiting"])));
    for (const w of waitingMachines) if (w.mr) await MachineRuntime.requestCancel(w.mr, workspaceId).catch(() => undefined);
    await db.update(arcRunNodes).set({ status: "skipped" }).where(and(eq(arcRunNodes.arcRunId, runId), inArray(arcRunNodes.status, ["pending", "queued", "waiting"])));
    await db.update(arcApprovals).set({ status: "cancelled" }).where(and(eq(arcApprovals.arcRunId, runId), eq(arcApprovals.status, "pending")));
    await this.event(runId, null, "run", "ARC RUN CANCELLED BY OPERATOR");
  }

  private static async bumpArc(arcId: string, success: boolean, cost: number, durationMs: number) {
    const s = success ? 1 : 0;
    await db.update(arcs).set({
      runsCompleted: sql`${arcs.runsCompleted} + 1`, successfulRuns: sql`${arcs.successfulRuns} + ${s}`,
      successRate: sql`round(((${arcs.successfulRuns} + ${s})::numeric / (${arcs.runsCompleted} + 1)) * 1000) / 10`,
      totalCost: sql`${arcs.totalCost} + ${cost}`, totalDurationMs: sql`${arcs.totalDurationMs} + ${durationMs}`,
      lastRunAt: new Date(), lastRunStatus: success ? "completed" : "failed",
    }).where(eq(arcs.id, arcId));
  }

  private static async emitArc(run: Run, status: string, output: string) {
    if (run.isTest) return;
    try {
      const [a] = await db.select({ name: arcs.name }).from(arcs).where(eq(arcs.id, run.arcId));
      const { emitEvent } = await import("@/lib/automation/triggers");
      await emitEvent({ workspaceId: run.workspaceId, sourceType: "arc", sourceId: run.arcId, status, output, depth: run.triggerDepth, name: a?.name ?? "ARC" });
    } catch { /* events are best-effort; the run outcome is already persisted */ }
  }

  // ---------- Helpers ----------
  private static runNodes(runId: string) { return db.select().from(arcRunNodes).where(eq(arcRunNodes.arcRunId, runId)); }

  private static async complete(runId: string, key: string, r: { branch: string; input?: { text?: string }; output: Record<string, unknown> & { text?: string }; cost?: number; t0: number }) {
    await db.update(arcRunNodes).set({ status: "completed", branch: r.branch, ...(r.input ? { inputPayload: r.input } : {}), outputPayload: r.output, cost: r.cost ?? 0, completedAt: new Date(), durationMs: Date.now() - r.t0 })
      .where(and(eq(arcRunNodes.arcRunId, runId), eq(arcRunNodes.nodeKey, key), this.nodeOwner(runId)));
  }

  static context(graph: Graph, rns: RunNode[], input: string): RefContext {
    const ctx: RefContext = { trigger: { input, output: input, status: "completed" } };
    for (const rn of rns) {
      const n = graph.nodes.find((x) => x.key === rn.nodeKey);
      if (!n || n.type === "trigger") continue;
      const entry = { input: rn.inputPayload?.text, output: rn.status === "completed" || rn.status === "failed" ? String(rn.outputPayload?.text ?? "") : undefined, status: rn.status };
      for (const k of [refName(n), n.label, n.key]) ctx[k.toLowerCase()] = entry;
    }
    return ctx;
  }

  static upstreamText(graph: Graph, rns: RunNode[], key: string) {
    const by = new Map(rns.map((r) => [r.nodeKey, r]));
    return graph.edges.filter((e) => e.target === key).map((e) => {
      const p = by.get(e.source); const n = graph.nodes.find((x) => x.key === e.source);
      if (!p || !n || !edgeActive(e, p)) return null;
      const t = n.type === "trigger" ? undefined : p.outputPayload?.text;
      return n.type === "trigger" ? String(p.outputPayload?.text ?? "") : t ? `[${refName(n)}${e.sourceHandle && HANDLE_LABEL[e.sourceHandle] ? ` · ${HANDLE_LABEL[e.sourceHandle]}` : ""}]\n${t}` : null;
    }).filter(Boolean).join("\n\n");
  }

  private static async event(runId: string, nodeKey: string | null, type: string, message: string) {
    await db.insert(arcRunEvents).values({ arcRunId: runId, nodeKey, type, message });
  }
  private static async activity(workspaceId: string, actor: string, message: string, severity = "info") {
    await db.insert(activities).values({ workspaceId, category: "arcs", actor, message, severity });
  }

  static async events(runId: string) { return db.select().from(arcRunEvents).where(eq(arcRunEvents.arcRunId, runId)).orderBy(asc(arcRunEvents.createdAt)); }
}
