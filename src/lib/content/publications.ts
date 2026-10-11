export type PublicationSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  code?: string;
  callout?: { title: string; body: string };
};

export type Publication = {
  slug: string;
  title: string;
  description: string;
  category: "docs" | "whitepaper" | "investors";
  sections: PublicationSection[];
};

export function publicationHref(publication: Publication): string {
  return publication.slug === "overview" ? `/${publication.category}` : `/${publication.category}/${publication.slug}`;
}

export const PUBLICATIONS: Publication[] = [
  {
    category: "docs",
    slug: "overview",
    title: "The MachinArc handbook",
    description: "Understand Machines, connect them into Arcs, and follow work from its first instruction to its final result.",
    sections: [
      {
        id: "a-workspace-for-ai-work",
        title: "A workspace for AI work",
        paragraphs: [
          "MachinArc is a working prototype for defining, coordinating, and inspecting AI tasks. A Machine holds an objective, a model choice, a set of tools, and execution limits. An Arc connects Machines with decisions, reviews, delays, and an output.",
          "The workspace brings configuration and execution together. You can describe the work, submit a task, inspect its run, and make approval decisions without treating each model response as a separate conversation.",
        ],
      },
      {
        id: "the-three-building-blocks",
        title: "The three building blocks",
        paragraphs: ["Start with one Machine and one short task. Build an Arc when the work needs a sequence, a decision, or a handoff. Add automation after the manual path is clear."],
        bullets: [
          "Machine: a configured worker with an objective, tools, permissions, memory settings, and budgets.",
          "Run: one execution with persisted state, tool activity, approval decisions, usage, and an outcome.",
          "Arc: a directed workflow that coordinates Machines and operator decisions around a shared input.",
        ],
      },
      {
        id: "what-you-can-evaluate-today",
        title: "What you can evaluate today",
        paragraphs: [
          "The public demo uses Mock Runtime. It lets you explore the product's configuration, workflow, and review experience with simulated model output and external tool behavior. Each visitor receives a separate workspace, credential connections are disabled, and initial schedules are turned off.",
          "Registered workspaces have OpenAI and Anthropic integration paths. A real AI provider acceptance run is still pending because no provider key has been supplied. Demo output demonstrates the product flow; it does not establish the quality or cost of live AI execution.",
        ],
        callout: { title: "A seven-day evaluation workspace", body: "Visitor sessions expire seven days after creation. Maintenance removes eligible expired demo workspaces in bounded batches while preserving active work. Use a registered account for work you intend to retain." },
      },
    ],
  },
  {
    category: "docs",
    slug: "quickstart",
    title: "Your first Machine run",
    description: "Explore the demo, configure a focused worker, and learn to read its execution history.",
    sections: [
      {
        id: "enter-a-workspace",
        title: "Enter a workspace",
        paragraphs: [
          "Choose Enter Demo to explore without an account, or register an operator account to create a workspace you can return to. Demo access creates an isolated workspace containing example Machines and an Arc with seeded history.",
          "Treat seeded history as sample material. A fresh run is the useful next step: it shows how your instruction passes through the current runtime and appears in the workspace.",
        ],
      },
      {
        id: "give-the-machine-a-clear-job",
        title: "Give the Machine a clear job",
        paragraphs: [
          "Open a Machine or create one from a starter. Write an objective that names the input, the expected result, and the boundaries of the task. Add success criteria so you have a concrete way to judge the output.",
          "Keep the initial configuration small. Use Mock Runtime, a short runtime, a modest turn limit, and only the tools the task needs. The example below is an instruction you can adapt, rather than a claim about an existing result.",
        ],
        code: "Objective: Summarize the product notes supplied by the operator.\nSuccess criteria: Identify the main changes, separate facts from questions, and produce a concise briefing.\nBoundary: Use supplied material only. Do not contact external systems.",
      },
      {
        id: "submit-and-inspect",
        title: "Submit and inspect",
        paragraphs: [
          "Submit a short task, then open its run. Follow the status, tool requests, tool results, and final output. If the task pauses for approval, read the proposed action before deciding whether to continue.",
          "A completed status means the runtime reached a completed outcome. Review the substance of the result separately against your success criteria. Check whether the run used the requested provider or a mock fallback before interpreting any usage or cost figures.",
        ],
        bullets: ["Confirm the input matches the task you intended to submit.", "Inspect tools and approvals rather than judging only the final text.", "Revise one part of the configuration at a time, then run another small task."],
      },
      {
        id: "move-to-real-execution",
        title: "Move to real execution",
        paragraphs: [
          "In a registered workspace, open Settings → Integrations and connect an OpenAI or Anthropic key. Choose that provider and an available model on the Machine. Start with a short task without tools that can change external systems.",
          "Verify the provider, output, usage, and configured cost calculation in the run. Next, enable a calculator and inspect its request and result. Evaluate any approval-controlled external action separately before relying on an automated workflow.",
        ],
      },
    ],
  },
  {
    category: "docs",
    slug: "machines",
    title: "Designing a Machine",
    description: "Configure the objective, tools, memory, output format, and limits of a single worker.",
    sections: [
      {
        id: "objective-and-success-criteria",
        title: "Objective and success criteria",
        paragraphs: [
          "A Machine is the reusable configuration behind a task. Its objective explains what it should accomplish; success criteria explain what a useful result contains. The system prompt adds context and instructions to that configuration.",
          "Prefer a bounded job such as preparing a briefing from supplied notes over a broad mandate such as managing a business. A narrower objective makes tool selection, review, and failure diagnosis easier.",
        ],
      },
      {
        id: "tools-and-output",
        title: "Tools and output",
        paragraphs: [
          "Tools supply specific capabilities: public web search, page retrieval, HTTP requests, arithmetic, structured extraction, memory writes, and delegation to another workspace Machine. An enabled tool remains subject to permission checks. Tools marked as requiring a sandbox cannot be enabled until that runtime exists.",
          "Use text output for a briefing and structured output when a later step needs named fields. Structured field definitions support types such as strings, numbers, booleans, and URLs. Validation checks the shape of the result; you still need to assess whether its content is correct.",
        ],
      },
      {
        id: "memory-and-continuity",
        title: "Memory and continuity",
        paragraphs: [
          "Memory mode determines whether a Machine retrieves no saved memories, uses context within the current run, or retrieves persistent memories for later tasks. Structured memory adds typed facts and entities to persistent memory. Run history remains a separate execution record.",
          "Choose persistent memory when the task benefits from stable facts you can inspect and curate. Choose session memory when each run should begin from its supplied input. Memory writes are a permissioned action, not an automatic reason to treat a generated statement as true.",
        ],
      },
      {
        id: "execution-limits",
        title: "Execution limits",
        paragraphs: [
          "Runtime, model turns, and tool-call limits bound the amount of work a run can attempt. Daily, monthly, and per-task budgets add cost boundaries. Delegated work contributes to the execution and cost story of the parent task.",
          "The builder permits runtime settings up to 900 seconds, but hosted function execution is bounded to 300 seconds. Keep the full task and its delegation inside the hosted budget. Longer execution needs a dedicated worker.",
        ],
        bullets: ["Begin with few tools and small limits, then expand after inspecting results.", "Pause a Machine when you want to prevent new work; inspect active runs separately.", "Use cancellation to stop a run and review any action that may already have occurred."],
      },
    ],
  },
  {
    category: "docs",
    slug: "arcs",
    title: "Connecting work with Arcs",
    description: "Compose Machines into a visible workflow with decisions, operator review, delays, and outputs.",
    sections: [
      {
        id: "start-with-the-flow",
        title: "Start with the flow",
        paragraphs: [
          "An Arc is a directed workflow. A trigger introduces the input, Machine nodes perform tasks, and an output node defines the result. Decision nodes choose a branch; human review nodes pause for an operator; delay nodes wait before continuing.",
          "Design the flow around explicit handoffs. A research step can produce a briefing, an analysis step can extract a decision field, and a review step can present that result to an operator. Each step should have a reason to exist.",
        ],
      },
      {
        id: "references-and-decisions",
        title: "References and decisions",
        paragraphs: [
          "Instructions and output templates can refer to upstream context. Give nodes clear labels or aliases so a later step can identify the result it needs. Decision conditions support comparisons, text containment, and checks for a field's presence.",
          "When a decision depends on a number or boolean, prefer a structured field over trying to infer meaning from a paragraph. Review the true and false branches and make the resulting action explicit.",
        ],
      },
      {
        id: "validate-before-deploying",
        title: "Validate before deploying",
        paragraphs: [
          "The builder validates the graph before execution. Resolve structural problems and unavailable Machine references, then use a test run to inspect the path through the graph. Deploy the Arc when it is ready to accept ordinary runs.",
          "A run stores a graph snapshot, so its execution can be understood against the workflow that started it. Inspect node outcomes and run events when a branch fails or a review is waiting, rather than assuming the overall status explains the cause.",
        ],
      },
      {
        id: "review-and-failure-paths",
        title: "Review and failure paths",
        paragraphs: [
          "Choose what a Machine node should do when its task fails: stop the workflow, skip the step, or ask for review. A human review node has explicit approve and reject paths. Make both paths useful before attaching an automated trigger.",
          "Arcs currently prevent a second active run of the same Arc. Account for that behavior when scheduling work or sending repeated webhook requests; a busy workflow can skip a new automated start.",
        ],
      },
    ],
  },
  {
    category: "docs",
    slug: "permissions",
    title: "Permissions and approvals",
    description: "Set capability boundaries and review proposed actions before they execute.",
    sections: [
      {
        id: "three-permission-modes",
        title: "Three permission modes",
        paragraphs: [
          "Permissions are evaluated by server code. The model can propose an action, but it cannot grant itself access. Machine settings, workspace restrictions, tool availability, and run approvals participate in that decision.",
          "DENY blocks a capability. ASK pauses work for an operator decision. ALLOW permits the capability within the remaining checks and execution limits. Tool-specific restrictions can still require approval, including external writes without a configured domain allow-list.",
        ],
        bullets: ["Network reads and memory writes are allowed in the conservative default configuration.", "Network writes and Machine delegation ask for approval by default.", "External communication, financial actions, code execution, and self-modification are denied by default."],
      },
      {
        id: "read-the-proposed-action",
        title: "Read the proposed action",
        paragraphs: [
          "An approval is attached to the proposed tool call and its arguments. Inspect the destination, payload summary, purpose, and risk before approving. Decide based on the action that will execute, rather than the apparent confidence of the model's explanation.",
          "A one-time approval is narrower than a run-wide grant. Permanent approval from the approval card is available only for selected permissions such as network reads, memory writes, and Machine calls. Other permanent changes belong in the Machine's configuration.",
        ],
      },
      {
        id: "understand-recovery",
        title: "Understand recovery",
        paragraphs: [
          "Approval state and tool results are persisted. Recovery can complete unanswered calls and reuse completed results after a process interruption.",
          "If a tool was interrupted and its external outcome is unknown, the run stops instead of replaying an action that may already have happened. Check the destination and reconcile its state before manually starting similar work. This boundary matters most for writes and messages.",
        ],
      },
      {
        id: "scope-access-deliberately",
        title: "Scope access deliberately",
        paragraphs: [
          "Enable only the tools needed for the objective, restrict destination domains where supported, and keep external actions behind review during evaluation. Store integration credentials through the server-side integration flow.",
          "Permission checks help constrain execution. They do not certify the correctness of model output or eliminate the need to evaluate the external system receiving an action.",
        ],
      },
    ],
  },
  {
    category: "docs",
    slug: "automation",
    title: "Schedules, webhooks, and events",
    description: "Start work from time, an incoming request, or a completed workflow while keeping execution visible.",
    sections: [
      {
        id: "choose-a-trigger",
        title: "Choose a trigger",
        paragraphs: [
          "Automation creates a new Machine task or Arc run from a schedule, webhook, or event. A schedule uses an interval or cron expression. A webhook accepts an incoming request through its tokenized endpoint. An event trigger reacts to a Machine or Arc outcome.",
          "Run the target manually first. Use a clear input template and verify the target's output, permissions, and timing before allowing repeated starts. Visitor demos begin with schedules disabled.",
        ],
      },
      {
        id: "overlap-and-trigger-chains",
        title: "Overlap and trigger chains",
        paragraphs: [
          "A scheduled Machine can skip an occurrence when earlier work is still active, or queue another task when that overlap policy is selected. Arcs enforce their own active-run restriction. A skipped start is a recorded outcome you can inspect.",
          "Event templates can include the source output and status. Trigger-chain depth is bounded to reduce accidental loops between targets. Prefer a workflow with a visible stopping point over a cycle that continually starts more work.",
        ],
      },
      {
        id: "durable-delivery",
        title: "Durable delivery",
        paragraphs: [
          "Due schedules advance and enqueue their fire jobs in one transaction. Trigger job receipts tie a stable job identity to its outcome, so reclaiming the same job reuses its recorded result instead of creating another run.",
          "Run creation, execution-job enqueueing, the trigger receipt, and schedule counters commit together. An infrastructure failure rolls that transaction back for retry. This protects the start of the workflow; individual external actions still need their own recovery and review boundaries.",
        ],
      },
      {
        id: "the-worker-is-part-of-the-system",
        title: "The worker is part of the system",
        paragraphs: [
          "Submitting work and executing it are separate steps. The durable queue needs a worker to claim jobs. Hosted installations use authenticated worker requests from a trusted scheduler; a dedicated worker is available where a continuously running process is supported.",
          "If tasks remain queued, first check worker activity and scheduler access. For live workloads, verify that the scheduler actually reaches the deployment and that a submitted task progresses through to its outcome.",
        ],
      },
    ],
  },
  {
    category: "docs",
    slug: "integrations",
    title: "Connecting providers and tools",
    description: "Understand mock execution, provider selection, credentials, search, and custom APIs.",
    sections: [
      {
        id: "mock-and-real-providers",
        title: "Mock and real providers",
        paragraphs: [
          "Mock Runtime is the default model configuration and the only provider used in visitor demos. Mock output and simulated external tool calls support product evaluation without consuming a connected provider key.",
          "Registered workspaces can configure OpenAI or Anthropic. Provider resolution checks workspace credentials, then platform configuration, and can fall back to Mock Runtime when no usable key is configured. Inspect the selected execution mode in the run before treating output as a live provider result.",
        ],
      },
      {
        id: "credential-handling",
        title: "Credential handling",
        paragraphs: [
          "Connect a provider through Settings → Integrations. Workspace credentials are encrypted at rest by the server, using the deployment's encryption configuration. The server reads them for execution; they are not returned as plaintext to the client.",
          "Visitor demos cannot save or read integration credentials, including credentials imported into an older demo workspace. Use a registered workspace and an appropriately scoped provider key for a live evaluation.",
        ],
      },
      {
        id: "search-and-custom-apis",
        title: "Search and custom APIs",
        paragraphs: [
          "Web search supports configured search providers and a keyless search path. Page retrieval extracts readable content from public pages. Network tools apply URL and destination checks; the content they retrieve remains external, untrusted input.",
          "A custom API defines its base URL, actions, parameter schema, and authentication method. Start with a narrow action and review its request shape against the destination's documentation. Treat writes as changes to a real system, and evaluate their approval behavior separately.",
        ],
      },
      {
        id: "provider-acceptance",
        title: "Provider acceptance",
        paragraphs: [
          "The application includes provider adapters, but a live provider acceptance run has not yet been completed. The next validation step is a short registered-workspace task with a supplied provider key, followed by a deterministic tool call and a separate approval scenario.",
          "Acceptance should confirm the requested provider, actual output, usage, configured cost calculation, and tool telemetry without a mock fallback. A successful connection check alone does not establish the complete task flow.",
        ],
      },
    ],
  },
  {
    category: "docs",
    slug: "operations",
    title: "Operating MachinArc",
    description: "The deployment, persistence, recovery, and verification model behind the workspace.",
    sections: [
      {
        id: "application-and-database",
        title: "Application and database",
        paragraphs: [
          "MachinArc uses Next.js with server-side PostgreSQL access through Drizzle. Application sessions identify operators, and server actions scope workspace operations. The browser does not use the Supabase Data API to read application tables.",
          "Apply the registered Drizzle migrations in sequence. Use a dedicated server database role, enable row-level security, revoke public client-role access, and verify the server role's grants and policies. Supply the trusted database root certificate through DATABASE_SSL_CA so certificate verification remains enabled.",
        ],
      },
      {
        id: "workers-and-function-budgets",
        title: "Workers and function budgets",
        paragraphs: [
          "Hosted web processes run with MARC_WORKER=off. A trusted scheduler sends an authenticated POST to /api/internal/worker once per minute. The endpoint advances schedules, recovers eligible orphaned work, and drains a bounded batch of jobs. Its credential and any deployment-protection access must match the deployment.",
          "Hosted function execution is limited to 300 seconds. Keep task runtime and delegation inside that total budget. Use npm run worker for longer execution on infrastructure that supports a continuous process, and disable in-process workers on the accompanying web processes.",
        ],
      },
      {
        id: "maintenance-and-recovery",
        title: "Maintenance and recovery",
        paragraphs: [
          "Workers reclaim expired job leases and resume eligible persisted runs. Recovery respects unanswered tool calls, durable results, and an interrupted action whose outcome cannot safely be inferred.",
          "Maintenance prunes expired shared rate-limit buckets and eligible visitor demos in bounded batches. Login and demo provisioning limits are shared across processes through PostgreSQL. Runtime and tool limits remain process-local, so they are not a fleet-wide quota mechanism.",
        ],
      },
      {
        id: "verification-and-secrets",
        title: "Verification and secrets",
        paragraphs: [
          "Use Node.js 22 or newer and install the locked dependencies. Keep database credentials, integration encryption keys, and scheduler secrets in ignored local configuration or deployment secret variables. A build needs database configuration; disable worker startup during it.",
          "Database integration tests require TEST_DATABASE_URL to explicitly select a separate disposable database. Apply migrations there first, then verify the task and recovery paths without using live data. Static checks, a successful build, and a reachable health endpoint answer different questions from a completed provider-backed task.",
        ],
        code: "npm ci\nnpm run typecheck\nnpm run lint\nnpm test\nnpm run test:integration",
      },
    ],
  },
  {
    category: "whitepaper",
    slug: "overview",
    title: "From prompts to inspectable work",
    description: "The architecture and thesis behind MachinArc: bounded Machines, visible workflows, and durable human oversight.",
    sections: [
      {
        id: "the-thesis",
        title: "The thesis",
        paragraphs: [
          "A prompt can initiate useful work, but a sustained workflow needs more than a response. It needs a defined objective, a record of attempted actions, a way to stop or approve those actions, and a clear account of how the result was produced.",
          "MachinArc explores an operating layer around AI execution. Its central objects are configured Machines, individual runs, and Arcs that coordinate work. The design makes execution state available to operators instead of asking them to reconstruct it from a final paragraph.",
        ],
      },
      {
        id: "the-unit-of-work",
        title: "The unit of work",
        paragraphs: [
          "A Machine combines an objective and success criteria with a model, tool set, permission configuration, memory mode, and execution limits. A task supplies the input for a run of that configuration. Separating configuration from a particular run makes the intended behavior easier to inspect and revise.",
          "An Arc composes these units into a directed workflow. Its nodes include Machine execution, branching decisions, human review, delays, and final output. A graph snapshot anchors each run to the workflow that created it, while node records expose progress and failure paths.",
        ],
      },
      {
        id: "system-architecture",
        title: "System architecture",
        paragraphs: [
          "The application uses Next.js, server actions, PostgreSQL, and Drizzle. Server-side application sessions establish operator identity, and workspace-scoped queries enforce access boundaries. Application tables are protected from public Data API roles; the server connects through a dedicated database role with explicit grants and row-level policies.",
          "A PostgreSQL job queue separates submission from execution. Workers claim jobs using database locking and leases. A hosted scheduler invokes a bounded worker endpoint, while a dedicated process supports work that needs a longer execution window.",
        ],
        bullets: ["Control plane: workspace configuration, sessions, permissions, integrations, and operator decisions.", "Execution plane: provider calls, tool execution, workflow advancement, and bounded workers.", "Persistence plane: tasks, runs, graph snapshots, approvals, results, usage, and job receipts."],
      },
      {
        id: "durability-is-a-product-property",
        title: "Durability is a product property",
        paragraphs: [
          "The runtime persists messages, proposed tool calls, tool execution records, approval state, and results. Recovery reconciles unanswered calls before advancing the model conversation and reuses a completed result where one exists.",
          "Trigger creation has a separate durability boundary. Schedule advancement and fire-job enqueueing are transactional. A stable trigger job receipt records the start outcome, and the created run, its driver job, and schedule counters commit together. A reclaimed delivery can refer to the same outcome without creating another run.",
          "These mechanisms support restart recovery, but they do not make arbitrary external side effects exactly once. When an interrupted action has an unknown outcome, execution stops for reconciliation rather than replaying a change that may already have occurred.",
        ],
      },
      {
        id: "trust-and-authorization",
        title: "Trust and authorization",
        paragraphs: [
          "The model proposes actions; server code decides whether a tool is available and whether its permission can proceed. Machine modes, workspace restrictions, tool rules, and operator approvals define the executable boundary. Retrieved external material is treated as input, not as a source of authority to change those rules.",
          "Human review is part of the execution model. An approval describes a proposed action and pauses work for a decision. Operators can grant a narrow approval or use a supported broader mode, while the run retains the decision as part of its history.",
          "The design reduces ambiguity about authorization. It does not establish that every model statement is accurate, that every allowed action is appropriate, or that every external destination is safe. Those remain evaluation and operational responsibilities.",
        ],
      },
      {
        id: "economics-and-resource-boundaries",
        title: "Economics and resource boundaries",
        paragraphs: [
          "Model turns, tool calls, runtime, and budgets bound the work a task can attempt. Usage is recorded separately from the cost calculation, which depends on the application's configured model pricing. Delegation adds child work to the parent execution story.",
          "Workspace Credits and network interactions are prototype accounting concepts. They are not evidence of settled customer payments, an open provider marketplace, or validated commercial unit economics. Live provider costs, customer willingness to pay, and support requirements still need measurement.",
        ],
      },
      {
        id: "current-state",
        title: "Current state",
        paragraphs: [
          "MachinArc is a working prototype with an isolated public demo, configurable Machines, a visual Arc workflow, approval handling, durable jobs, and restart recovery paths. The public demo uses Mock Runtime and seeded example history. It cannot connect credentials and has a seven-day visitor lifecycle.",
          "OpenAI and Anthropic adapters exist for registered workspaces. Real-provider acceptance remains pending because no AI provider key has been supplied. Mock execution demonstrates application behavior, not live model reliability or paid workload economics.",
        ],
      },
      {
        id: "present-limitations",
        title: "Present limitations",
        paragraphs: [
          "Hosted function execution is bounded to 300 seconds; longer work requires a dedicated worker. A deployed target still needs a functioning scheduler or worker to make progress. Runtime and tool throttles are local to a process, while login and demo provisioning limits share PostgreSQL state across instances.",
          "Tools requiring an isolated code sandbox remain unavailable. Provider pricing is configured in a registry and may differ from actual billing. Recovery deliberately stops ambiguous external actions. These are practical boundaries for evaluation and deployment, rather than completed guarantees of production readiness.",
        ],
      },
      {
        id: "validation-roadmap",
        title: "Validation roadmap",
        paragraphs: [
          "The immediate validation path begins with a short real-provider task, then a deterministic tool call, and then an approval-controlled action. Each stage should confirm the requested provider, recorded usage, outcome, and behavior under interruption.",
          "The next product questions concern repeated use: which workflows users trust, how much review they need, whether outcomes meet clear criteria, and what execution and support cost. Longer-running work, broader integrations, and additional operational controls should follow evidence from those evaluations.",
        ],
      },
    ],
  },
  {
    category: "investors",
    slug: "overview",
    title: "Building the operating layer for AI work",
    description: "A candid view of the product thesis, intended users, commercial hypotheses, and validation milestones.",
    sections: [
      {
        id: "the-product-thesis",
        title: "The product thesis",
        paragraphs: [
          "As AI tasks extend beyond drafting a response, users need a way to configure workers, coordinate steps, review actions, and understand outcomes. MachinArc explores that need through Machines and Arcs: bounded workers connected into inspectable workflows.",
          "The opportunity being tested is whether this operating layer can turn a useful individual task into repeatable work that an operator can oversee. The prototype makes that question concrete through configuration, execution history, approvals, and recovery behavior.",
        ],
      },
      {
        id: "who-it-is-for",
        title: "Who it is for",
        paragraphs: [
          "Initial user hypotheses include small operations teams, analysts, and technical builders who repeat research, synthesis, or structured information workflows. These are intended audiences, not a list of customers or a claim of validated demand.",
          "A useful initial workflow has a clear input, a result that can be reviewed, and a natural point for operator approval. The product should earn broader permissions through demonstrated usefulness on those narrower tasks.",
        ],
      },
      {
        id: "what-exists-today",
        title: "What exists today",
        paragraphs: [
          "The working prototype includes workspace sessions, Machine configuration, a visual Arc builder, tool permissions, approval flows, durable job execution, trigger receipts, and recovery paths. An isolated public demo exposes the product experience with mock execution and sample history.",
          "Real AI provider acceptance is pending. The demo is a way to inspect the product thesis and interface; it does not demonstrate paying users, live AI performance, retention, or revenue.",
        ],
      },
      {
        id: "commercial-hypotheses",
        title: "Commercial hypotheses",
        paragraphs: [
          "A workspace subscription could support configuration, collaboration, and operational visibility. Usage-related charges could reflect execution resources, while a bring-your-own-provider-key path could let users retain a direct relationship with their AI provider. These are business-model hypotheses, not current billing commitments.",
          "A credible model needs measured provider cost, infrastructure cost, support effort, review burden, and willingness to pay. Prototype Credits and configured usage estimates should not be read as revenue or validated margins.",
        ],
      },
      {
        id: "validation-milestones",
        title: "Validation milestones",
        paragraphs: ["The next milestones should establish reliable execution first, then useful repeated work, and then a commercial relationship worth sustaining."],
        bullets: [
          "Complete real-provider acceptance for a short task, a tool call, and an approval-controlled action.",
          "Evaluate a small set of bounded workflows against explicit output criteria and interruption scenarios.",
          "Observe repeated operator use and identify where configuration or review creates friction.",
          "Measure delivery cost and willingness to pay before committing to packaging or pricing.",
          "Establish operational practices for monitoring, recovery, credential rotation, and customer support.",
        ],
      },
      {
        id: "questions-to-underwrite",
        title: "Questions to underwrite",
        paragraphs: [
          "The core risks are practical: whether outcomes are useful enough to repeat, whether operator review is manageable, whether external integrations can recover safely, and whether delivery cost supports a viable product. Competition and provider dependencies also need evaluation rather than a presumed advantage.",
          "The relevant evidence is a complete workflow: input, execution, action history, operator decisions, output quality, and cost. A polished demo or a completed run alone cannot answer all of those questions.",
        ],
      },
      {
        id: "evaluate-the-work",
        title: "Evaluate the work",
        paragraphs: [
          "Start with the public demo to understand the configuration and review experience. Read the handbook for operating details and the whitepaper for the architecture and its boundaries. The next meaningful evidence will come from real-provider acceptance and workflow evaluation.",
          "Use the validation milestones to assess the next stage of development. The product and its commercial assumptions should advance together as execution quality, repeated use, and delivery economics become measurable.",
        ],
      },
    ],
  },
];
