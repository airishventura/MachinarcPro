// Minimal 5-field cron: minute hour day-of-month month day-of-week.
// Supports *, numbers, ranges a-b, lists a,b, steps */n and a-b/n. No seconds, no names.
const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

function parseField(f: string, [lo, hi]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of f.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? Number(stepS) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step in "${part}"`);
    let a = lo, b = hi;
    if (range !== "*") { const [x, y] = range.split("-").map(Number); a = x; b = y ?? (stepS ? hi : x); }
    if (![a, b].every((n) => Number.isInteger(n) && n >= lo && n <= hi) || a > b) throw new Error(`Value out of range in "${part}" (${lo}-${hi})`);
    for (let i = a; i <= b; i += step) out.add(i === 7 && hi === 6 ? 0 : i);
  }
  return out;
}

export function parseCron(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron needs 5 fields: minute hour day month weekday");
  const [min, hour, dom, mon, dow] = parts.map((p, i) => parseField(p, RANGES[i]));
  return { min, hour, dom, mon, dow, domStar: parts[2] === "*", dowStar: parts[4] === "*" };
}

/** Validate and canonicalize an IANA timezone; existing schedules default to UTC. */
export function scheduleTimezone(timezone = "UTC"): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
}

/**
 * Next actual fire time strictly after `from`, matching wall-clock time in `timezone`.
 * Missing DST minutes are skipped; a repeated DST minute can fire at both UTC instants.
 */
export function nextCron(expr: string, from = new Date(), timezone = "UTC"): Date {
  const c = parseCron(expr);
  const zone = scheduleTimezone(timezone);
  if (!Number.isFinite(from.getTime())) throw new Error("Invalid schedule start time");
  const formatter = zone === "UTC" ? null : new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  });
  const d = new Date(from); d.setUTCSeconds(0, 0); d.setUTCMinutes(d.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    let month = d.getUTCMonth() + 1, day = d.getUTCDate(), weekday = d.getUTCDay(), hour = d.getUTCHours(), minute = d.getUTCMinutes();
    if (formatter) {
      const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
      month = Number(parts.month); day = Number(parts.day); hour = Number(parts.hour); minute = Number(parts.minute);
      weekday = new Date(Date.UTC(Number(parts.year), month - 1, day)).getUTCDay();
    }
    const domOk = c.dom.has(day), dowOk = c.dow.has(weekday);
    const dayOk = c.domStar && c.dowStar ? true : c.domStar ? dowOk : c.dowStar ? domOk : domOk || dowOk;
    if (c.mon.has(month) && dayOk && c.hour.has(hour) && c.min.has(minute)) return d;
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  throw new Error("Cron expression never fires");
}

export function describeSchedule(s: { kind: string; intervalSec?: number | null; cron?: string | null; timezone?: string | null }) {
  if (s.kind === "interval" && s.intervalSec) {
    const m = s.intervalSec / 60;
    return m < 60 ? `Every ${m} min` : m % 1440 === 0 ? `Every ${m / 1440} day${m === 1440 ? "" : "s"}` : `Every ${+(m / 60).toFixed(1)} h`;
  }
  return `Cron ${s.cron} (${s.timezone ?? "UTC"})`;
}
