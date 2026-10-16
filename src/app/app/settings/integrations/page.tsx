import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PROVIDERS } from "@/config/models";
import { getIntegration, providerConfigured, secretHint } from "@/lib/integrations/service";
import { ToolRegistry, type CustomApiConfig } from "@/lib/tools/registry";
import { encryptionKeyConfigured } from "@/lib/security/crypto";
import { ago } from "@/lib/domain";
import { CustomApiBuilder, ProviderCard, RemoveIntegration, SearchCard, StatusBadge } from "@/components/settings/integrations-client";
import { chatgptLocalStatus } from "@/lib/integrations/chatgpt-local";
import { isDemoWorkspace } from "@/lib/integrations/service";

export const dynamic = "force-dynamic";

export default async function Integrations({ searchParams }: { searchParams: Promise<{ chatgpt?: string }> }) {
  const { workspace } = await requireSession();
  const query = await searchParams;
  if (await isDemoWorkspace(workspace.id)) {
    return <div className="space-y-6">
      <PageHeader title="INTEGRATIONS" sub="This visitor workspace uses Mock Runtime. Credential connections and integration changes are disabled."><Link href="/app/settings" className="btn">Settings</Link></PageHeader>
      <section aria-labelledby="demo-provider" className="border border-line bg-bg3 p-5">
        <h2 id="demo-provider" className="t-section">MOCK RUNTIME · BUILT-IN</h2>
        <p className="mt-3 text-sm leading-relaxed text-mute">Try Machine configuration, simulated external tools, and run inspection without connecting an account or supplying API keys. No real external sources are accessed.</p>
      </section>
      <section aria-labelledby="demo-connections" className="border border-line p-5">
        <h2 id="demo-connections" className="t-section">CREDENTIAL CONNECTIONS DISABLED</h2>
        <p className="mt-3 text-sm leading-relaxed text-mute">OpenAI, Anthropic, search-provider credentials, and custom API configuration require a registered workspace. ChatGPT sign-in is local-only and unavailable in visitor demos. Do not enter secrets into a demo.</p>
        <Link href="/docs/status#real-ai" className="btn mt-4">Real AI capabilities &amp; limits</Link>
      </section>
    </div>;
  }
  const chatgpt = await chatgptLocalStatus(workspace.id);
  const providers = await Promise.all((["openai", "anthropic"] as const).map(async (id) => {
    const [row, mode] = await Promise.all([getIntegration(workspace.id, id), providerConfigured(workspace.id, id)]);
    const hint = row ? await secretHint(workspace.id, row.id) : null;
    const status = row?.status === "auth_error" || row?.status === "error" ? row.status : mode ? "connected" : "not_connected";
    return { id, name: PROVIDERS[id].label, status, mode, hint, lastSuccess: row?.lastSuccessAt ? ago(row.lastSuccessAt).toUpperCase() : null, lastError: row?.status === "auth_error" || row?.status === "error" ? row.lastError : null, docs: PROVIDERS[id].docs! };
  }));
  const search = await getIntegration(workspace.id, "web_search");
  const searchHasKey = search ? !!(await secretHint(workspace.id, search.id)) : false;
  const apis = await ToolRegistry.customApis(workspace.id);
  const anyProvider = providers.some((p) => p.mode) || chatgpt?.connected;

  return (
    <div className="space-y-8">
      <PageHeader title="INTEGRATIONS" sub="Connect intelligence providers, tools and external systems. Secrets are encrypted at rest and never reach the browser or Machine prompts."><Link href="/app/settings" className="btn">Settings</Link></PageHeader>
      {!anyProvider && <div className="border border-warn/40 bg-warn/5 p-4"><div className="t-section !text-warn">NO AI PROVIDER CONNECTED</div><p className="t-secondary mt-1">Connect a provider to execute real Machine tasks. Until then Machines run on clearly labeled Mock Runtime with simulated tools.</p></div>}
      {!encryptionKeyConfigured() && <p className="font-mono text-[11px] text-dim">DEV NOTICE · MARC_ENCRYPTION_KEY is not set; credentials use a development-derived key. Set a 32+ character key in production.</p>}

      <section aria-labelledby="ai"><h2 id="ai" className="t-section mb-3">AI PROVIDERS</h2>
        {chatgpt && <div className="mb-3 space-y-3 border border-line bg-bg3 p-4">
          <div className="flex items-center justify-between"><h3 className="font-mono tracking-wider">CHATGPT · LOCAL ONLY</h3><StatusBadge s={chatgpt.connected ? "connected" : "not_connected"} /></div>
          <p className="t-secondary">Connect your ChatGPT plan for this local workspace&apos;s Machines. Use a personal workspace with one owner/member. Tokens stay encrypted on this computer. Open the app at http://127.0.0.1 to sign in.</p>
          {chatgpt.account && <p className="t-caption">Selected account: {chatgpt.account}</p>}
          <p className="t-caption">Plan limits and configured credits apply. API prices do not describe ChatGPT plan charges. <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer" className="underline">Manage usage in ChatGPT</a></p>
          {query.chatgpt === "failed" && <p role="alert" className="text-warn">Sign-in did not complete. The existing connection was preserved. Retry and grant ChatGPT plan permission.</p>}
          {query.chatgpt === "connected" && <p role="status" className="text-ok">ChatGPT connected. Create a Machine using a model from your account catalog.</p>}
          {query.chatgpt === "disconnected" && <p role="status">ChatGPT disconnected.</p>}
          {query.chatgpt === "revocation_unconfirmed" && <p role="alert" className="text-warn">Disconnected locally. Remote revocation was not confirmed; disconnect MachinArc in ChatGPT Settings.</p>}
          <form action="/api/local-chatgpt" method="post" className="flex flex-wrap gap-2">
            {!!chatgpt.accounts.length && <label className="flex items-center gap-2">ChatGPT account<select name="account" defaultValue={chatgpt.selected} className="input">{chatgpt.accounts.map(a => <option value={a.clientId} key={a.clientId}>{a.label}</option>)}</select></label>}
            <button name="action" value="connect" className="btn btn-primary">Continue with ChatGPT</button>
            {chatgpt.account && <button name="action" value="different" className="btn">Use a different ChatGPT account</button>}
            {chatgpt.connected && <button name="action" value="disconnect" className="btn">Disconnect ChatGPT</button>}
          </form>
        </div>}
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
