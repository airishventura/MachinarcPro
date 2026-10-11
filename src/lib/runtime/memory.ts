import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { machineMemories } from "@/db/schema";

const STOP = new Set("the a an and or of to in for on with by is are was were be this that it as at from about into over under any all find each why what which who how".split(" "));
const terms = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/**
 * Retrieves a bounded set of relevant memories by lexical relevance + importance + recency (+ pinned).
 * Architected so an embedding score (pgvector) can be added as another term without changing callers.
 */
export async function retrieveMemories(machineId: string, task: string, limit = 5) {
  const rows = await db.select().from(machineMemories).where(eq(machineMemories.machineId, machineId)).orderBy(desc(machineMemories.createdAt)).limit(300);
  const q = terms(task);
  const now = Date.now();
  const scored = rows.map((m) => {
    const t = terms(`${m.content} ${m.summary}`);
    let overlap = 0; for (const w of q) if (t.has(w)) overlap++;
    const relevance = q.size ? overlap / Math.sqrt(q.size * Math.max(1, t.size)) : 0;
    const ageDays = (now - m.createdAt.getTime()) / 864e5;
    const score = relevance * 3 + m.importance / 5 + Math.exp(-ageDays / 30) * 0.5 + (m.pinned ? 2 : 0);
    return { m, score, relevance };
  }).filter((x) => x.m.pinned || x.relevance > 0.05 || x.m.importance >= 5).sort((a, b) => b.score - a.score).slice(0, limit);
  const ids = scored.map((x) => x.m.id);
  if (ids.length) await db.update(machineMemories).set({ usedCount: sql`${machineMemories.usedCount} + 1`, lastAccessedAt: new Date() }).where(inArray(machineMemories.id, ids));
  return scored.map((x) => x.m);
}

export async function writeMemory(p: { machineId: string; workspaceId: string; content: string; importance: number; kind: string; source: string; runId?: string }) {
  const content = p.content.trim().slice(0, 1000);
  const [dupe] = await db.select({ id: machineMemories.id }).from(machineMemories).where(and(eq(machineMemories.machineId, p.machineId), eq(machineMemories.content, content))).limit(1);
  if (dupe) return dupe;
  const [m] = await db.insert(machineMemories).values({ machineId: p.machineId, workspaceId: p.workspaceId, content, summary: content.slice(0, 140), importance: Math.max(1, Math.min(5, Math.round(p.importance))), kind: p.kind, source: p.source, sourceRunId: p.runId }).returning({ id: machineMemories.id });
  return m;
}
