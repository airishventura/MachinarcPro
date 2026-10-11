import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { PageHeader, Section } from "@/components/ui";
import { logoutAction } from "@/app/actions";

export default async function Settings() {
  const { user, workspace } = await requireSession();
  return (
    <div className="space-y-6">
      <PageHeader title="SETTINGS" sub="Operator, workspace and intelligence providers." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="OPERATOR">
          <dl className="divide-y divide-line text-sm">{[["Name", user.name], ["Email", user.email], ["Auth", user.googleId ? "Google" : "Email / password"]].map(([k, v]) => <div key={k} className="flex justify-between px-4 py-3"><dt className="label">{k}</dt><dd className="font-mono">{v}</dd></div>)}</dl>
          <form action={logoutAction} className="border-t border-line p-4"><button className="btn">Sign out</button></form>
        </Section>
        <Section title="WORKSPACE">
          <dl className="divide-y divide-line text-sm">{[["Workspace", workspace.name], ["Plan", workspace.plan], ["Credits", workspace.credits.toFixed(2)], ["Workspace ID", workspace.id.slice(0, 13)]].map(([k, v]) => <div key={k} className="flex justify-between px-4 py-3"><dt className="label">{k}</dt><dd className="font-mono">{v}</dd></div>)}</dl>
        </Section>
        <Section title="INTEGRATIONS" className="lg:col-span-2">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="t-secondary">AI providers, web search, custom APIs and credentials. Secrets are encrypted at rest and never reach the browser.</p><Link href="/app/settings/integrations" className="btn btn-primary">Manage Integrations</Link></div>
        </Section>
      </div>
    </div>
  );
}
