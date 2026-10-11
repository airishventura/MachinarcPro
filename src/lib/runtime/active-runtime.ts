type ApprovalWait = { createdAt: Date; decidedAt: Date | null; status: string };

/** Durable approval intervals pause the deadline without resetting time already spent executing. */
export function activeRuntimeMs(startedAt: Date, approvals: ApprovalWait[], nowMs = Date.now()): number {
  const start = startedAt.getTime();
  const waits = approvals.flatMap((approval): [number, number][] => {
    const end = approval.decidedAt?.getTime() ?? (approval.status === "pending" ? nowMs : null);
    if (end === null) return []; // Legacy resolved records cannot prove when their wait ended.
    const from = Math.max(start, approval.createdAt.getTime());
    const to = Math.min(nowMs, end);
    return to > from ? [[from, to]] : [];
  }).sort((a, b) => a[0] - b[0]);
  let pausedMs = 0;
  let previousEnd = start;
  for (const [from, to] of waits) {
    pausedMs += Math.max(0, to - Math.max(from, previousEnd));
    previousEnd = Math.max(previousEnd, to);
  }
  return Math.max(0, nowMs - start - pausedMs);
}
