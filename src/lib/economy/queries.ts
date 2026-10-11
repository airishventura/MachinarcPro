import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { machines, machineRuns, runUsage, transactions } from "@/db/schema";

/** Lifetime aggregates are independent of the bounded tables and chart. USD never offsets Credits. */
export async function getEconomyState(workspaceId: string) {
  const realUsage = and(eq(machines.workspaceId, workspaceId), ne(runUsage.provider, "mock"));
  const [txs, [totals], usage, perMachine] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.workspaceId, workspaceId)).orderBy(desc(transactions.createdAt)).limit(100),
    db.select({
      revenue: sql<number>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)`.mapWith(Number),
      spend: sql<number>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
      avg: sql<number>`coalesce(avg(${transactions.amount}), 0)`.mapWith(Number),
    }).from(transactions).where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.status, "complete"))),
    db.select({ cost: runUsage.cost }).from(runUsage)
      .innerJoin(machineRuns, eq(machineRuns.id, runUsage.machineRunId))
      .innerJoin(machines, eq(machines.id, machineRuns.machineId))
      .where(realUsage).orderBy(desc(runUsage.createdAt)).limit(48),
    db.select({ id: machines.id, name: machines.name, cost: sql<number>`coalesce(sum(${runUsage.cost}), 0)`.mapWith(Number), unknown: sql<number>`count(*) filter (where ${runUsage.cost} is null)`.mapWith(Number) })
      .from(runUsage).innerJoin(machineRuns, eq(machineRuns.id, runUsage.machineRunId))
      .innerJoin(machines, eq(machines.id, machineRuns.machineId))
      .where(realUsage).groupBy(machines.id, machines.name).orderBy(desc(sql`sum(${runUsage.cost})`)),
  ]);
  return { txs, totals, usage: usage.reverse(), perMachine, compute: perMachine.reduce((sum, row) => sum + row.cost, 0), unknown: perMachine.reduce((sum, row) => sum + row.unknown, 0) };
}
