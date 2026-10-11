export function fmtDuration(ms: number) {
  if (!ms) return "0s";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function fmtUsd(n: number, digits?: number) {
  const d = digits ?? (n !== 0 && Math.abs(n) < 0.1 ? 4 : 2);
  return `$${n.toFixed(d)}`;
}
