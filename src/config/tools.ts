// Client-safe tool catalog + permission model. Executors live server-side in src/lib/tools.

export const PERMISSIONS = [
  { key: "network_read", label: "Network read", desc: "Search and read public web content.", risk: "low" },
  { key: "network_write", label: "Network write", desc: "Send data to external systems (POST, webhooks).", risk: "high" },
  { key: "external_communication", label: "External communication", desc: "Email, chat and social messages.", risk: "high" },
  { key: "code_execution", label: "Code execution", desc: "Run code in a sandbox.", risk: "high" },
  { key: "financial_action", label: "Financial action", desc: "Spend Credits or money.", risk: "critical" },
  { key: "machine_call", label: "Machine call", desc: "Delegate tasks to other Machines.", risk: "medium" },
  { key: "memory_write", label: "Memory write", desc: "Store long-term memories.", risk: "low" },
  { key: "data_export", label: "Data export", desc: "Export workspace data externally.", risk: "high" },
  { key: "self_modification", label: "Self modification", desc: "Change its own configuration.", risk: "critical" },
  { key: "machine_creation", label: "Machine creation", desc: "Create new Machines.", risk: "critical" },
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export type PermissionMode = "DENY" | "ASK" | "ALLOW";

/** Conservative defaults for new Machines. */
export const DEFAULT_PERMISSIONS: Record<PermissionKey, PermissionMode> = {
  network_read: "ALLOW", network_write: "ASK", external_communication: "DENY", code_execution: "DENY", financial_action: "DENY",
  machine_call: "ASK", memory_write: "ALLOW", data_export: "DENY", self_modification: "DENY", machine_creation: "DENY",
};

export type ToolCategory = "RESEARCH" | "DEVELOPER" | "DATA" | "COMMUNICATION" | "MACHINARC";
export type ToolMeta = { id: string; name: string; description: string; category: ToolCategory; permission: PermissionKey | null; risk: "low" | "medium" | "high"; defaultOn?: boolean; status?: "available" | "sandbox_required"; level: "READ" | "WRITE" | "EXECUTE" };

export const TOOL_CATALOG: ToolMeta[] = [
  { id: "web_search", name: "Web Search", description: "Search the live web and return titles, URLs and snippets.", category: "RESEARCH", permission: "network_read", risk: "low", defaultOn: true, level: "READ" },
  { id: "fetch_page", name: "Fetch Page", description: "Retrieve a public page and extract readable text.", category: "RESEARCH", permission: "network_read", risk: "low", defaultOn: true, level: "READ" },
  { id: "http_request", name: "HTTP Request", description: "GET/POST to allow-listed external APIs.", category: "DEVELOPER", permission: "network_read", risk: "high", level: "WRITE" },
  { id: "code_execution", name: "Code Execution", description: "Run code in an isolated sandbox.", category: "DEVELOPER", permission: "code_execution", risk: "high", status: "sandbox_required", level: "EXECUTE" },
  { id: "extract_structured", name: "Structured Extractor", description: "Turn text into validated structured data.", category: "DATA", permission: null, risk: "low", defaultOn: true, level: "READ" },
  { id: "calculator", name: "Calculator", description: "Deterministic arithmetic outside the model.", category: "DATA", permission: null, risk: "low", defaultOn: true, level: "READ" },
  { id: "datetime", name: "Time / Date", description: "Current time, timezones and date math.", category: "DATA", permission: null, risk: "low", defaultOn: true, level: "READ" },
  { id: "remember", name: "Memory Write", description: "Propose a long-term memory for this Machine.", category: "MACHINARC", permission: "memory_write", risk: "low", level: "WRITE" },
  { id: "request_machine", name: "Request Machine", description: "Delegate a sub-task to another Machine in this workspace.", category: "MACHINARC", permission: "machine_call", risk: "medium", level: "EXECUTE" },
  { id: "request_approval", name: "Human Approval", description: "Ask the operator to confirm before continuing.", category: "MACHINARC", permission: null, risk: "low", level: "READ" },
];

export const toolMeta = (id: string): ToolMeta | undefined => TOOL_CATALOG.find((t) => t.id === id) ?? (id.startsWith("api__") ? { id, name: id.slice(5).replace(/__/g, " · "), description: "Custom API action", category: "DEVELOPER", permission: "network_read", risk: "medium", level: "WRITE" } : undefined);

export const MEMORY_MODES = [
  { key: "none", label: "None", desc: "Stateless. Nothing is retained." },
  { key: "session", label: "Session", desc: "Tool results and facts live only within the current Run." },
  { key: "persistent", label: "Persistent", desc: "Curated long-term memories retrieved by relevance." },
  { key: "structured", label: "Structured", desc: "Persistent memories typed as entities and facts." },
] as const;

export type OutputField = { key: string; type: "string" | "number" | "boolean" | "url"; description?: string; required?: boolean };
