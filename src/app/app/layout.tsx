import { ShellNav } from "@/components/shell-nav";
import { requireSession } from "@/lib/auth";
import { privatePageMetadata } from "@/lib/seo";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = privatePageMetadata("Workspace");

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (
    <div className="min-h-screen bg-bg">
      <a href="#main" className="skip-link">Skip to content</a>
      <ShellNav user={s.user.name} ws={s.workspace.name} credits={s.workspace.credits} />
      <main id="main" tabIndex={-1} className="pb-20 outline-none lg:pb-0 lg:pl-60">
        <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
          {s.workspace.policy.demo && <aside aria-label="Demo workspace" className="mb-6 border border-amber/40 bg-amber/5 p-4 text-sm leading-relaxed text-mute"><strong className="text-fg">Mock Runtime demo.</strong> External tools and example history are simulated. Network hires do not execute or move Credits. Credential connections are disabled. <Link href="/docs/status" className="text-amber underline underline-offset-4">Beta status &amp; limits</Link></aside>}
          {children}
        </div>
      </main>
    </div>
  );
}
