/** Small, consistent interface symbols. Labels carry meaning; icons are decorative. */
const paths = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  machine: "M6 6h12v12H6z M9 9h6v6H9z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4",
  workflow: "M3 4h5v5H3z M16 15h5v5h-5z M8 6.5h6a4 4 0 0 1 4 4V15 M11 13l3-3-3-3",
  network: "M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M19 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M10 8l-4 7 M14 8l4 7 M8 18h8",
  automation: "M13 2 4 14h7l-1 8 10-13h-7z",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  plus: "M12 4v16 M4 12h16",
  templates: "M3 4h18v16H3z M3 9h18 M9 9v11",
  wallet: "M3 6a2 2 0 0 1 2-2h14v4 M3 6v13a1 1 0 0 0 1 1h17V8H5a2 2 0 0 1-2-2 M21 12h-6v4h6 M17 14h.01",
  plug: "M8 2v5 M16 2v5 M6 7h12v3a6 6 0 0 1-12 0z M12 16v6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  book: "M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1z M12 5v15",
  play: "M8 4v16l12-8z",
  pause: "M8 4v16 M16 4v16",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6",
  tools: "M14 6a5 5 0 0 0-6 6l-6 6 4 4 6-6a5 5 0 0 0 6-6l-3 3-4-4z",
  chart: "M4 3v17h17 M8 15l4-5 4 2 4-7",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2",
  check: "M4 12l5 5L20 6",
  inbox: "M3 14 6 4h12l3 10v6H3z M3 14h5l2 3h4l2-3h5",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-2a8 8 0 0 1 16 0v2",
  mail: "M3 5h18v14H3z M3 5l9 8 9-8",
  lock: "M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  logout: "M10 3H3v18h7 M8 12h13 M16 7l5 5-5 5",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name} className={`shrink-0 ${className}`}><path d={paths[name]} /></svg>;
}

const labels: Record<string, IconName> = {
  OVERVIEW: "overview", "COMMAND CENTER": "overview", WORKSPACE: "overview",
  MACHINES: "machine", "ACTIVE MACHINES": "machine", "MACHINES ONLINE": "machine",
  ARCS: "workflow", "ACTIVE ARCS": "workflow", "RECENT ARC RUNS": "workflow",
  NETWORK: "network", AUTOMATION: "automation", ACTIVITY: "activity",
  "NEW MACHINE": "plus", "NEW ARC": "workflow", TEMPLATES: "templates",
  ECONOMY: "wallet", "SPEND TODAY": "wallet", INTEGRATIONS: "plug", SETTINGS: "settings",
  OPERATOR: "user", AUTHORIZATION: "shield", TELEMETRY: "activity",
  "REAL TOOLS": "tools", "HUMAN AUTHORIZATION": "shield", "DURABLE RUNTIME": "clock", "FULL TELEMETRY": "activity",
  "TOOLS & PERMISSIONS": "tools", "RUN TELEMETRY": "activity",
  "TASKS RUNNING": "play", "TASKS COMPLETED": "check", "SUCCESS RATE": "chart", "ARC RUNS TODAY": "clock",
  CREATE: "plus", EQUIP: "tools", DEPLOY: "play", EVOLVE: "chart",
};

export function iconForLabel(label: string): IconName | undefined {
  return labels[label.toUpperCase()];
}
