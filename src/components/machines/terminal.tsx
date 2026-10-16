"use client";
import { useEffect, useRef, useState } from "react";
import { hhmmssUtc } from "@/lib/domain";
import type { LogDTO } from "@/types/machine";

export const levelColor = (l: string) =>
  ({ ERROR: "text-bad", "TOOL ERROR": "text-bad", WARNING: "text-warn", APPROVAL: "text-warn", PERMISSION: "text-mute", "TOOL REQUEST": "text-proc", "TOOL RESULT": "text-ok", AI: "text-amber", PLAN: "text-fg", ANALYSIS: "text-amber", MEMORY: "text-ok", OUTPUT: "text-ok", "MACHINE CALL": "text-amber", "MACHINE RESULT": "text-amber", SYSTEM: "text-mute" } as Record<string, string>)[l] ?? "text-mute";

/** Live execution terminal: pausable auto-scroll, copy, clickable tool events. */
export function Terminal({ logs, live, title = "MACHINE TERMINAL", tall, onTool, selectedTool }: { logs: LogDTO[]; live: boolean; title?: string; tall?: boolean; onTool?: (id: string) => void; selectedTool?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const t0 = logs[0] ? new Date(logs[0].createdAt).getTime() : 0;
  useEffect(() => { if (follow) ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [logs, follow]);
  const onScroll = () => { const el = ref.current; if (el && live && follow && el.scrollHeight - el.scrollTop - el.clientHeight > 24) setFollow(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(logs.map((l) => `${hhmmssUtc(l.createdAt)} UTC [${l.level}] ${l.message}`).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  return (
    <section className="flex min-w-0 flex-col border border-line bg-[#070707]" aria-label={title}>
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        <span className="t-section !text-mute">{title} · UTC</span>
        <span className={`flex items-center gap-1.5 font-mono text-[10px] ${live ? "text-ok" : "text-dim"}`}><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${live ? "dot-live bg-ok" : "bg-dim"}`} />{live ? "STREAMING" : "IDLE"}</span>
        <div className="ml-auto flex gap-1">
          <button type="button" onClick={() => setFollow((f) => !f)} aria-pressed={follow} className={`h-7 border px-2 font-mono text-[10px] tracking-wider ${follow ? "border-line text-fg" : "border-warn/50 text-warn"}`}>{follow ? "AUTO-SCROLL" : "SCROLL PAUSED"}</button>
          <button type="button" onClick={copy} disabled={!logs.length} className="h-7 border border-line px-2 font-mono text-[10px] tracking-wider text-mute hover:text-fg disabled:opacity-40">{copied ? "COPIED" : "COPY"}</button>
        </div>
      </div>
      <div ref={ref} onScroll={onScroll} className={`overflow-y-auto overflow-x-hidden p-3 font-mono text-[12px] leading-6 sm:p-4 ${tall ? "h-[60vh]" : "h-[380px]"}`} role="log" aria-live="polite" aria-relevant="additions">
        {logs.length === 0 && <div className="text-dim">Awaiting first event…</div>}
        {logs.map((l) => {
          const click = l.toolExecutionId && onTool;
          const Row = click ? "button" : "div";
          return (
            <Row key={l.id} {...(click ? { type: "button" as const, onClick: () => onTool!(l.toolExecutionId!), "aria-label": `Inspect ${l.level} ${l.message}` } : {})}
              className={`fade-up grid w-full grid-cols-[auto_1fr] gap-x-3 text-left sm:grid-cols-[64px_52px_120px_1fr] ${click ? "hover:bg-panel" : ""} ${selectedTool && l.toolExecutionId === selectedTool ? "bg-panel2" : ""}`}>
              <span className="hidden text-dim tabular-nums sm:inline">{hhmmssUtc(l.createdAt)}</span>
              <span className="text-dim tabular-nums">+{Math.max(0, (new Date(l.createdAt).getTime() - t0) / 1000).toFixed(1)}s</span>
              <span className={`hidden sm:inline ${levelColor(l.level)}`}>[{l.level}]</span>
              <span className="min-w-0 break-words text-fg/90"><span className={`sm:hidden ${levelColor(l.level)}`}>[{l.level}] </span>{l.message}{click && <span className="ml-2 text-dim">↗</span>}</span>
            </Row>
          );
        })}
        {live && <div className="text-mute"><span className="text-dim">&gt;</span> <span className="caret">▍</span></div>}
      </div>
    </section>
  );
}
