import type { ArcNodeType, NodeConfig } from "@/lib/arcs/graph";

export type TemplateMachine = { name: string; type: string; description: string; objective: string; systemPrompt: string };
export type ArcTemplate = {
  key: string; name: string; description: string; objective: string; hidden?: boolean;
  nodes: { key: string; type: ArcNodeType; label: string; machine?: TemplateMachine; config?: NodeConfig }[];
  edges: [string, string, string?][];
};

const M = {
  scout: { name: "SCOUT-01", type: "research", description: "Market intelligence", objective: "Detect emerging technology signals before mainstream adoption.", systemPrompt: "You are a signal-detection Machine. Prefer primary sources." },
  researcher: { name: "RESEARCHER-01", type: "analysis", description: "Deep research", objective: "Produce evidence-backed research with an explicit confidence score.", systemPrompt: "Separate facts from inference. Always state CONFIDENCE." },
  analyst: { name: "ANALYST-01", type: "analysis", description: "Strategic analysis", objective: "Rank findings by strategic relevance and estimate confidence.", systemPrompt: "Be decisive. Quantify." },
  reporter: { name: "REPORTER-01", type: "custom", description: "Executive reporting", objective: "Turn research into concise executive briefs.", systemPrompt: "Write for executives: short, structured, no filler." },
  writer: { name: "WRITER-01", type: "custom", description: "Long-form writing", objective: "Draft clear, well-structured articles from research.", systemPrompt: "Write clearly. Cite sources." },
  monitor: { name: "MONITOR-01", type: "monitoring", description: "Competitor monitoring", objective: "Track competitor launches, pricing and hiring.", systemPrompt: "Report only material changes." },
  issue: { name: "ISSUE-ANALYZER-01", type: "coding", description: "Issue triage", objective: "Classify and reproduce incoming software issues.", systemPrompt: "Identify root cause candidates." },
  code: { name: "CODE-RESEARCHER-01", type: "coding", description: "Code research", objective: "Locate relevant code paths and prior art for an issue.", systemPrompt: "Reference files and functions precisely." },
  planner: { name: "PLANNER-01", type: "coding", description: "Solution planning", objective: "Produce an implementation plan with a test strategy.", systemPrompt: "Minimal, safe changes first." },
} satisfies Record<string, TemplateMachine>;

export const ARC_TEMPLATES: ArcTemplate[] = [
  {
    key: "market-intelligence", name: "MARKET INTELLIGENCE", description: "Scout → Researcher → Analyst → Output",
    objective: "Continuously surface and rank emerging market opportunities.",
    nodes: [
      { key: "trigger", type: "trigger", label: "MANUAL TRIGGER", config: { triggerKind: "manual" } },
      { key: "scout", type: "machine", label: "SCOUT", machine: M.scout, config: { instruction: "Scan for emerging signals related to:\n{{trigger.input}}", onFailure: "stop", retries: 1 } },
      { key: "researcher", type: "machine", label: "RESEARCHER", machine: M.researcher, config: { instruction: "Research these signals in depth:\n\n{{SCOUT.output}}", onFailure: "stop", retries: 0 } },
      { key: "analyst", type: "machine", label: "ANALYST", machine: M.analyst, config: { instruction: "Rank each finding by strategic relevance:\n\n{{RESEARCHER.output}}", onFailure: "stop", retries: 0 } },
      { key: "out", type: "output", label: "FINAL OUTPUT", config: { outputName: "MARKET INTELLIGENCE REPORT", template: "{{ANALYST.output}}" } },
    ],
    edges: [["trigger", "scout"], ["scout", "researcher"], ["researcher", "analyst"], ["analyst", "out"]],
  },
  {
    key: "content-engine", name: "CONTENT ENGINE", description: "Researcher → Writer → Human Review → Output",
    objective: "Research, draft and approve publishable content.",
    nodes: [
      { key: "trigger", type: "trigger", label: "MANUAL TRIGGER", config: { triggerKind: "manual" } },
      { key: "researcher", type: "machine", label: "RESEARCHER", machine: M.researcher, config: { instruction: "Research this topic for an article:\n{{trigger.input}}", onFailure: "stop", retries: 0 } },
      { key: "writer", type: "machine", label: "WRITER", machine: M.writer, config: { instruction: "Draft an article from this research:\n\n{{RESEARCHER.output}}", onFailure: "stop", retries: 1 } },
      { key: "review", type: "human_review", label: "EDITORIAL REVIEW", config: { title: "APPROVE DRAFT FOR PUBLISHING", reason: "Every article requires editorial sign-off.", display: "{{WRITER.output}}" } },
      { key: "out", type: "output", label: "PUBLISHED DRAFT", config: { outputName: "APPROVED ARTICLE", template: "{{WRITER.output}}" } },
      { key: "rej", type: "output", label: "REJECTED DRAFT", config: { outputName: "DRAFT REJECTED", template: "Draft rejected by editor.\n\n{{WRITER.output}}" } },
    ],
    edges: [["trigger", "researcher"], ["researcher", "writer"], ["writer", "review"], ["review", "out", "approve"], ["review", "rej", "reject"]],
  },
  {
    key: "software-triage", name: "SOFTWARE TRIAGE", description: "Issue Analyzer → Code Researcher → Solution Planner → Output",
    objective: "Turn incoming issues into actionable implementation plans.",
    nodes: [
      { key: "trigger", type: "trigger", label: "MANUAL TRIGGER", config: { triggerKind: "manual" } },
      { key: "issue", type: "machine", label: "ISSUE ANALYZER", machine: M.issue, config: { instruction: "Analyze this issue:\n{{trigger.input}}", onFailure: "stop", retries: 0 } },
      { key: "code", type: "machine", label: "CODE RESEARCHER", machine: M.code, config: { instruction: "Find relevant code paths for:\n\n{{ISSUE ANALYZER.output}}", onFailure: "skip", retries: 0 } },
      { key: "planner", type: "machine", label: "SOLUTION PLANNER", machine: M.planner, config: { instruction: "Plan a fix.\n\nIssue:\n{{ISSUE ANALYZER.output}}\n\nCode context:\n{{CODE RESEARCHER.output}}", onFailure: "stop", retries: 1 } },
      { key: "out", type: "output", label: "FINAL OUTPUT", config: { outputName: "IMPLEMENTATION PLAN", template: "{{SOLUTION PLANNER.output}}" } },
    ],
    edges: [["trigger", "issue"], ["issue", "code"], ["code", "planner"], ["planner", "out"]],
  },
  {
    key: "competitor-watch", name: "COMPETITOR WATCH", description: "Monitor → Analyst → Decision → Output",
    objective: "Detect material competitor moves and escalate high-confidence threats.",
    nodes: [
      { key: "trigger", type: "trigger", label: "MANUAL TRIGGER", config: { triggerKind: "manual" } },
      { key: "monitor", type: "machine", label: "MONITOR", machine: M.monitor, config: { instruction: "Check competitor activity for:\n{{trigger.input}}", onFailure: "stop", retries: 1 } },
      { key: "analyst", type: "machine", label: "ANALYST", machine: M.analyst, config: { instruction: "Assess the threat level of these changes:\n\n{{MONITOR.output}}", onFailure: "stop", retries: 0 } },
      { key: "decision", type: "decision", label: "THREAT CHECK", config: { field: "{{ANALYST.output.confidence}}", operator: "gte", value: "0.8" } },
      { key: "alert", type: "output", label: "COMPETITIVE ALERT", config: { outputName: "COMPETITIVE ALERT", template: "{{ANALYST.output}}" } },
      { key: "watch", type: "output", label: "WATCHLIST UPDATE", config: { outputName: "WATCHLIST UPDATE", template: "{{ANALYST.output}}" } },
    ],
    edges: [["trigger", "monitor"], ["monitor", "analyst"], ["analyst", "decision"], ["decision", "alert", "true"], ["decision", "watch", "false"]],
  },
  {
    key: "emerging-tech", name: "EMERGING TECH INTELLIGENCE", description: "Scout → Researcher → Confidence Check → Reporter (with Human Review)",
    objective: "Detect emerging technology and brief operators; escalate low-confidence findings to a human.",
    nodes: [
      { key: "trigger", type: "trigger", label: "MANUAL TRIGGER", config: { triggerKind: "manual" } },
      { key: "scout", type: "machine", label: "SCOUT", machine: M.scout, config: { instruction: "Scan for emerging signals related to:\n{{trigger.input}}", alias: "", onFailure: "stop", retries: 1 } },
      { key: "researcher", type: "machine", label: "RESEARCHER", machine: M.researcher, config: { instruction: "Research the strongest signals and estimate confidence:\n\n{{SCOUT.output}}", onFailure: "stop", retries: 0 } },
      { key: "check", type: "decision", label: "CONFIDENCE CHECK", config: { field: "{{RESEARCHER.output.confidence}}", operator: "gte", value: "0.8" } },
      { key: "review", type: "human_review", label: "HUMAN REVIEW", config: { title: "OPERATOR REVIEW REQUIRED", reason: "Research confidence ({{RESEARCHER.output.confidence}}) is below the autonomous execution threshold of 0.80.", display: "{{RESEARCHER.output}}" } },
      { key: "reporter", type: "machine", label: "REPORTER", machine: M.reporter, config: { instruction: "Write an executive intelligence brief:\n\n{{RESEARCHER.output}}", onFailure: "stop", retries: 0 } },
      { key: "out", type: "output", label: "FINAL OUTPUT", config: { outputName: "EMERGING TECH BRIEF", template: "{{REPORTER.output}}" } },
      { key: "discard", type: "output", label: "SIGNALS DISCARDED", config: { outputName: "SIGNALS DISCARDED", template: "Operator rejected low-confidence findings.\n\n{{RESEARCHER.output}}" } },
    ],
    edges: [["trigger", "scout"], ["scout", "researcher"], ["researcher", "check"], ["check", "reporter", "true"], ["check", "review", "false"], ["review", "reporter", "approve"], ["review", "discard", "reject"], ["reporter", "out"]],
  },
];
