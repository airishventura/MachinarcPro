import Link from "next/link";
import { NetworkField } from "@/components/landing-viz";
import { Logo } from "@/components/ui";

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen md:grid-cols-2">
      <div className="flex flex-col px-6 py-8 md:px-14">
        <Link href="/"><Logo /></Link>
        <div className="my-auto w-full max-w-sm py-12">
          <h1 className="font-mono text-lg tracking-[.16em]">{title}</h1>
          <p className="mt-2 mb-8 text-sm text-mute">{sub}</p>
          {children}
        </div>
      </div>
      <div className="relative hidden border-l border-line bg-bg2 md:block">
        <div className="grid-bg absolute inset-0" />
        <div className="absolute inset-0"><NetworkField /></div>
        <div className="absolute bottom-10 left-10 font-mono text-xs tracking-[.2em] text-mute">BUILD MACHINES THAT LIVE ON THE INTERNET.</div>
      </div>
    </main>
  );
}
