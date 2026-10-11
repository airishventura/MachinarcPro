"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui";
import { logoutAction } from "@/app/actions";

const GROUPS: { title?: string; items: [string, string][] }[] = [
  { items: [["Overview", "/app"], ["Machines", "/app/machines"], ["Arcs", "/app/arcs"], ["Network", "/app/network"], ["Automation", "/app/automation"], ["Activity", "/app/activity"]] },
  { title: "BUILD", items: [["New Machine", "/app/machines/new"], ["New Arc", "/app/arcs/new"], ["Templates", "/app/templates"]] },
  { title: "SYSTEM", items: [["Economy", "/app/economy"], ["Integrations", "/app/settings/integrations"], ["Settings", "/app/settings"]] },
];

function isActive(path: string, href: string) {
  if (href === "/app/machines") return path === "/app/machines" || (path.startsWith("/app/machines/") && path !== "/app/machines/new");
  if (href === "/app/arcs") return path === "/app/arcs" || (path.startsWith("/app/arcs/") && path !== "/app/arcs/new");
  return path === href;
}

function NavBody({ user, ws, credits, onNav }: { user: string; ws: string; credits: number; onNav?: () => void }) {
  const path = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-line px-5"><Link href="/app" onClick={onNav}><Logo /></Link></div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {GROUPS.map((g, i) => (
          <div key={i} className="mb-5">
            {g.title && <div className="label mb-2 px-2 !text-dim">{g.title}</div>}
            {g.items.map(([label, href]) => {
              const a = isActive(path, href);
              return (
                <Link key={href} href={href} onClick={onNav} aria-current={a ? "page" : undefined}
                  className={`relative flex min-h-9 items-center px-2 py-1.5 text-sm transition-colors duration-[180ms] ${a ? "bg-panel2 text-fg" : "text-mute hover:text-fg"}`}>
                  {a && <span className="absolute left-0 top-1 bottom-1 w-px bg-amber" />}
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center border border-line font-mono text-xs">{user.slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{user}</div>
            <div className="truncate font-mono text-[10px] tracking-wider text-mute">{ws} · PRO</div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between font-mono text-[11px]"><span className="text-mute">CREDITS</span><span className="tabular-nums">{credits.toFixed(2)}</span></div>
        <form action={logoutAction}><button className="mt-3 w-full text-left font-mono text-[11px] tracking-widest text-dim hover:text-fg">SIGN OUT →</button></form>
      </div>
    </div>
  );
}

export function ShellNav(p: { user: string; ws: string; credits: number }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const tabs: [string, string][] = [["Overview", "/app"], ["Machines", "/app/machines"], ["Arcs", "/app/arcs"], ["Network", "/app/network"]];
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-bg2 lg:block"><NavBody {...p} /></aside>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/95 px-4 backdrop-blur lg:hidden">
        <Link href="/app"><Logo /></Link>
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="btn h-9 px-3">MENU</button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal>
          <div className="backdrop-in absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="drawer-in absolute inset-y-0 left-0 w-72 border-r border-line bg-bg2"><NavBody {...p} onNav={() => setOpen(false)} /></div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-bg2 lg:hidden">
        {tabs.map(([l, h]) => (
          <Link key={h} href={h} className={`relative flex min-h-12 items-center justify-center font-mono text-[10px] tracking-wider transition-colors duration-[180ms] ${isActive(path, h) ? "text-fg" : "text-mute"}`} aria-current={isActive(path, h) ? "page" : undefined}>{l.toUpperCase()}</Link>
        ))}
        <Link href="/app/machines/new" className="flex min-h-12 items-center justify-center bg-fg font-mono text-[10px] tracking-wider text-bg active:scale-[.97] transition-transform duration-[120ms]">+ NEW</Link>
      </nav>
    </>
  );
}
