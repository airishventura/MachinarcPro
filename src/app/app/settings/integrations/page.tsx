import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PROVIDERS } from "@/config/models";
import { getIntegration, providerConfigured, secretHint } from "@/lib/integrations/service";
import { ToolRegistry, type CustomApiConfig } from "@/lib/tools/registry";
import { encryptionKeyConfigured } from "@/lib/security/crypto";
import { ago } from "@/lib/domain";
import { CustomApiBuilder, ProviderCard, RemoveIntegration, SearchCard, StatusBadge } from "@/components/settings/integrations-client";

export const dynamic = "force-dynamic";

export default async function Integrations() {
  const { workspace } = await requireSession();
  const providers = await Promise.all((["openai", "anthropic"] as const).map(async (id) => {
    const [row, mode] = await Promise.all([getIntegration(workspace.id, id), providerConfigured(workspace.id, id)]);
    const hint = row ? await secretHint(workspace.id, row.id) : null;
    const status = row?.status === "auth_error" || row?.status === "error" ? row.status : mode ? "connected" : "not_connected";
    return { id, name: PROVIDERS[id].label, status, mode, hint, lastSuccess: row?.lastSuccessAt ? ago(row.lastSuccessAt).toUpperCase() : null, lastError: row?.status === "auth_error" || row?.status === "error" ? row.lastError : null, docs: PROVIDERS[id].docs! };
  }));
  const search = await getIntegration(workspace.id, "web_search");
  const searchHasKey = search ? !!(await secretHint(workspace.id, search.id)) : false;
  const apis = await ToolRegistry.customApis(workspace.id);
  const anyProvider = providers.some((p) => p.mode);

  return (
    <div className="space-y-8">
      <PageHeader title="INTEGRATIONS" sub="Connect intelligence providers, tools and external systems. Secrets are encrypted at rest and never reach the browser or Machine prompts."><Link href="/app/settings" className="btn">Settings</Link></PageHeader>
      {!anyProvider && <div className="border border-warn/40 bg-warn/5 p-4"><div className="t-section !text-warn">NO AI PROVIDER CONNECTED</div><p className="t-secondary mt-1">Connect a provider to execute real Machine tasks. Until then Machines run on clearly labeled Mock Runtime with simulated tools.</p></div>}
      {!encryptionKeyConfigured() && <p className="font-mono text-[11px] text-dim">DEV NOTICE · MARC_ENCRYPTION_KEY is not set; credentials use a development-derived key. Set a 32+ character key in production.</p>}

      <section aria-labelledby="ai"><h2 id="ai" className="t-section mb-3">AI PROVIDERS</h2>
        <div className="grid gap-px border border-line bg-line md:grid-cols-3">
          {providers.map((p) => <ProviderCard key={p.id} {...p} />)}
          <div className="flex flex-col bg-bg3 p-4"><div className="flex items-start justify-between"><div><div className="font-mono tracking-wider">MOCK RUNTIME</div><div className="t-caption mt-0.5">SIMULATED · NO CREDENTIALS</div></div><StatusBadge s="builtin" /></div><p className="t-secondary mt-3">Deterministic scripted model with simulated tools. Used automatically when a Machine&apos;s provider is not connected. Never performs real external work.</p></div>
        </div>
        <p className="t-caption mt-2">Coming next: Google, OpenRouter, local models and custom OpenAI-compatible endpoints — the provider interface already supports them.</p>
      </section>

      <section aria-labelledby="tools"><h2 id="tools" className="t-section mb-3">TOOLS</h2>
        <div className="grid gap-px border border-line bg-line md:grid-cols-3">
          <SearchCard provider={String(search?.config?.provider ?? "bing_rss")} hasKey={searchHasKey} />
          <div className="bg-bg3 p-4"><div className="flex items-start justify-between"><div><div className="font-mono tracking-wider">HTTP · FETCH PAGE</div><div className="t-caption mt-0.5">BUILT-IN NETWORK TOOLS</div></div><StatusBadge s="builtin" /></div>
            <ul className="t-secondary mt-3 space-y-1"><li>Private, loopback, link-local and metadata addresses blocked (checked at connect time)</li><li>Redirects re-validated · max 3</li><li>Timeouts and response size limits</li><li>POST requires approval without a domain allow-list</li></ul></div>
          <div className="bg-bg3 p-4"><div className="flex items-start justify-between"><div><div className="font-mono tracking-wider">CODE EXECUTION</div><div className="t-caption mt-0.5">ISOLATED SANDBOX</div></div><StatusBadge s="sandbox_required" /></div><p className="t-secondary mt-3">Disabled. MachinArc never executes Machine-written code on the application server. Enabling requires an isolated sandbox with CPU, memory, network and filesystem limits.</p></div>
        </div>
      </section>

      <section aria-labelledby="dev"><h2 id="dev" className="t-section mb-3">DEVELOPER</h2>
        <div className="grid gap-px border border-line bg-line md:grid-cols-2">
          <div className="bg-bg3 p-4"><div className="flex items-start justify-between"><div><div className="font-mono tracking-wider">WEBHOOK</div><div className="t-caption mt-0.5">INBOUND TRIGGERS</div></div><StatusBadge s="connected" /></div><p className="t-secondary mt-3">Inbound webhooks start Machines and Arcs via authenticated POST — create them in Automation. Outbound webhooks use HTTP Request (approval-gated).</p></div>
          <div className="bg-bg3 p-4"><div className="font-mono tracking-wider">CUSTOM API</div><p className="t-secondary mt-1">Describe an external API once; each action becomes a semantic Machine tool. Credentials are injected server-side — Machines never see them.</p></div>
        </div>
        <div className="mt-3 space-y-3">
          {apis.map((a) => { const c = a.config as unknown as CustomApiConfig; return (
            <div key={a.id} className="flex flex-col gap-2 border border-line p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono tracking-wider">{a.name.toUpperCase()}</span><StatusBadge s={a.status} /></div><div className="t-caption mt-0.5">{c.baseUrl} · AUTH {c.authType.toUpperCase()} · TOOL ID api__{a.slug}</div>
                <ul className="mt-2 space-y-0.5">{c.actions.map((x) => <li key={x.name} className="font-mono text-[11px]"><span className="text-amber">{x.method}</span> {x.path} <span className="text-dim">· {x.name}</span></li>)}</ul></div>
              <RemoveIntegration slug={a.slug} name={a.name} />
            </div>); })}
          <CustomApiBuilder />
        </div>
      </section>

      <section aria-labelledby="comm"><h2 id="comm" className="t-section mb-3">COMMUNICATION</h2>
        <div className="grid gap-px border border-line bg-line sm:grid-cols-3">{["Email", "Slack", "Discord"].map((n) => <div key={n} className="bg-bg3 p-4"><div className="flex items-start justify-between"><span className="font-mono tracking-wider">{n.toUpperCase()}</span><StatusBadge s="not_connected" /></div><p className="t-secondary mt-2">Planned. Will use the external-action preview and approval flow before any message is sent.</p></div>)}</div>
      </section>
    </div>
  );
}
