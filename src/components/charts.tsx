export function AreaChart({ data, height = 160, labels }: { data: number[]; height?: number; labels?: string[] }) {
  if (!data.length) return <div className="grid h-40 place-items-center font-mono text-xs text-dim">AWAITING TELEMETRY</div>;
  const w = 600, max = Math.max(...data) * 1.15 || 1;
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, height - (v / max) * height]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Usage chart">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={height * g} y2={height * g} stroke="#2a2c2b" strokeDasharray="2 4" />)}
        <path d={`${line} L${w},${height} L0,${height} Z`} fill="#d9c9a8" opacity="0.08" />
        <path d={line} fill="none" stroke="#d9c9a8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="#d9c9a8" />
      </svg>
      {labels && <div className="mt-2 flex justify-between font-mono text-[10px] text-dim">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>}
    </div>
  );
}
