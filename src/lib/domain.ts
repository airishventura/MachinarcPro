// Pure domain constants & helpers — shared by UI and server.
export const TYPE_LABEL: Record<string, string> = {
  research: "Research", analysis: "Analysis", monitoring: "Monitoring", coding: "Coding",
  content: "Content", trading: "Trading Simulation", operations: "Operations", custom: "Custom",
};
const TYPE_CODE: Record<string, string> = { research: "SCT", analysis: "ANL", monitoring: "SNT", coding: "FRG", content: "CNT", trading: "TRD", operations: "OPS", custom: "CST" };
export function machineCode(type: string) {
  return `MARC-${TYPE_CODE[type] ?? "CST"}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export type Starter = { label: string; name: string; type: string; description: string; objective: string; successCriteria: string; systemPrompt: string; tools?: string[]; memoryMode?: "none" | "session" | "persistent" | "structured"; outputMode?: "text" | "structured"; outputSchema?: { name: string; list: boolean; fields: { key: string; type: "string" | "number" | "boolean" | "url"; description?: string }[] }; flagship?: boolean };
const RESEARCH_PROMPT = "Use web_search to find current sources, then fetch_page the most relevant 2–4 pages before concluding. Cite every claim with the [S#] id from tool results. Store 1–2 durable facts with remember when useful. Output sections: EXECUTIVE SUMMARY, KEY FINDINGS, EVIDENCE, SOURCES, OPEN QUESTIONS.";
export const STARTERS: Record<string, Starter> = {
  scout: { label: "Scout", name: "SCOUT-01", type: "research", description: "Market intelligence", objective: "Continuously monitor emerging AI infrastructure projects and surface unusually fast-growing opportunities.", successCriteria: "Identify at least five high-confidence opportunities each week.", systemPrompt: RESEARCH_PROMPT, tools: ["web_search", "fetch_page", "calculator", "datetime", "remember"], memoryMode: "persistent" },
  researcher: { label: "Researcher", name: "RESEARCHER-01", type: "analysis", description: "Deep company & market research", objective: "Produce concise, evidence-backed research briefs on companies and markets assigned by the operator.", successCriteria: "Every brief contains thesis, evidence, risks and a confidence score.", systemPrompt: RESEARCH_PROMPT, tools: ["web_search", "fetch_page", "extract_structured", "remember"], memoryMode: "persistent" },
  builder: { label: "Builder", name: "FORGE-01", type: "coding", description: "Software builder", objective: "Inspect technical problems, research documentation and propose implementation plans with a test strategy.", successCriteria: "Plans reference real documentation and include a test plan.", systemPrompt: "You are a senior engineer. Read official documentation with fetch_page before recommending APIs.", tools: ["web_search", "fetch_page", "calculator"] },
  monitor: { label: "Monitor", name: "SENTINEL-01", type: "monitoring", description: "System monitoring", objective: "Check public status pages and endpoints; report anomalies to the operator.", successCriteria: "Report incidents with timestamps and affected services.", systemPrompt: "Fetch the specified status pages and summarize incidents. Escalate anything critical.", tools: ["fetch_page", "http_request", "datetime"] },
  research_scout: { flagship: true, label: "Research Scout", name: "RESEARCH-SCOUT", type: "research", description: "Evidence-backed briefings", objective: "Research a topic using real web sources and produce a concise evidence-backed briefing.", successCriteria: "Every key finding cites at least one accessed source.", systemPrompt: RESEARCH_PROMPT, tools: ["web_search", "fetch_page", "extract_structured", "datetime", "remember"], memoryMode: "persistent" },
  competitor_monitor: { flagship: true, label: "Competitor Monitor", name: "COMPETITOR-WATCH", type: "monitoring", description: "Competitive intelligence", objective: "Analyze a competitor using current public information.", successCriteria: "Cover latest developments, product changes, messaging and strategic implications with sources.", systemPrompt: "Use web_search and fetch_page on the competitor's site, blog and recent press. Output sections: LATEST DEVELOPMENTS, PRODUCT CHANGES, MESSAGING, STRATEGIC IMPLICATIONS, SOURCES. Cite with [S#]. Remember durable facts about the competitor.", tools: ["web_search", "fetch_page", "datetime", "remember"], memoryMode: "persistent" },
  api_analyst: { flagship: true, label: "API Analyst", name: "API-ANALYST", type: "analysis", description: "Structured API analysis", objective: "Retrieve structured information from a configured external API and summarize it.", successCriteria: "Return validated structured output with computed metrics.", systemPrompt: "Call the configured Custom API (or http_request GET for allow-listed public JSON APIs). Use calculator for all arithmetic. Never estimate numbers yourself.", tools: ["http_request", "calculator", "extract_structured"], outputMode: "structured", outputSchema: { name: "API Summary", list: false, fields: [{ key: "summary", type: "string", description: "Two-sentence summary" }, { key: "record_count", type: "number" }, { key: "key_metric", type: "number", description: "Most important computed number" }, { key: "confidence", type: "number" }] } },
};

/** Platform-level demo Machines. Never owned by a user workspace. */
export const DEMO_MACHINES = [
  { code: "SCOUT-01", id: "MARC-SCT-0001", purpose: "Market Intelligence", status: "running", task: "Scanning 142 sources", success: 98.4, tasks: 12842 },
  { code: "FORGE-07", id: "MARC-FRG-0007", purpose: "Software Builder", status: "running", task: "Generating patch for issue #412", success: 96.7, tasks: 4211 },
  { code: "SENTINEL-X", id: "MARC-SNT-0042", purpose: "System Monitoring", status: "running", task: "Watching 38 endpoints", success: 99.6, tasks: 30871 },
  { code: "ORACLE-14", id: "MARC-ANL-0014", purpose: "Forecasting", status: "idle", task: null, success: 94.3, tasks: 2190 },
  { code: "ARCHIVE-03", id: "MARC-OPS-0003", purpose: "Knowledge Management", status: "paused", task: null, success: 100, tasks: 8820 },
];

export const NETWORK_MACHINES = [
  { code: "DEEP-SCOUT-88", capability: "Deep Web Research", category: "Research", owner: "helix.labs", reputation: 98.8, tasks: 48281, price: 0.18, response: "1.2s", status: "AVAILABLE" },
  { code: "ANALYST-44", capability: "Signal & Company Analysis", category: "Data", owner: "northwind", reputation: 97.1, tasks: 21904, price: 0.42, response: "3.8s", status: "AVAILABLE" },
  { code: "RESEARCH-81", capability: "Market Research Reports", category: "Research", owner: "quanta.io", reputation: 95.4, tasks: 9210, price: 1.2, response: "12s", status: "BUSY" },
  { code: "FORGE-04", capability: "Code Generation", category: "Development", owner: "forgeworks", reputation: 96.7, tasks: 30112, price: 0.65, response: "6.1s", status: "AVAILABLE" },
  { code: "SENTINEL-X", capability: "24/7 Monitoring", category: "Monitoring", owner: "watchtower", reputation: 99.3, tasks: 112840, price: 0.05, response: "0.4s", status: "AVAILABLE" },
  { code: "LEDGER-12", capability: "Reconciliation & Accounting", category: "Finance", owner: "abacus", reputation: 94.2, tasks: 7781, price: 0.3, response: "2.2s", status: "AVAILABLE" },
  { code: "MUSE-09", capability: "Copy & Creative Direction", category: "Creative", owner: "atelier", reputation: 92.9, tasks: 14420, price: 0.25, response: "4.0s", status: "AVAILABLE" },
  { code: "OPS-RUNNER-2", capability: "Ops Automation", category: "Operations", owner: "relay", reputation: 96.0, tasks: 55012, price: 0.12, response: "0.9s", status: "OFFLINE" },
  { code: "QUANT-31", capability: "Time Series Forecasting", category: "Finance", owner: "sigma", reputation: 93.5, tasks: 6630, price: 0.8, response: "8.4s", status: "AVAILABLE" },
  { code: "SCRAPE-77", capability: "Structured Data Extraction", category: "Data", owner: "harvest", reputation: 97.8, tasks: 80122, price: 0.09, response: "1.6s", status: "AVAILABLE" },
];

export const money = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function ago(d: Date | string | null | undefined) {
  if (!d) return "—";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 30) return "NOW";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const hhmmss = (d: Date | string) => new Date(d).toTimeString().slice(0, 8);
export const hhmmssUtc = (d: Date | string) => new Date(d).toISOString().slice(11, 19);
