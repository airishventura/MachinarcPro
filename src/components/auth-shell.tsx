import Link from "next/link";
import { Logo } from "@/components/ui";
import { MotionArtwork } from "@/components/motion-artwork";

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen md:grid-cols-2">
      <div className="flex min-w-0 flex-col px-6 py-8 md:px-14">
        <Link href="/"><Logo /></Link>
        <div className="my-auto w-full min-w-0 max-w-sm py-12">
          <h1 className="font-mono text-lg tracking-[.16em]">{title}</h1>
          <p className="mt-2 mb-8 text-sm text-mute">{sub}</p>
          {children}
        </div>
      </div>
      <div className="relative hidden border-l border-line bg-bg2 md:block">
        <MotionArtwork src="/images/editorial/auth-scene.webp" variant="auth" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/20" />
        <div className="absolute inset-x-8 bottom-10 lg:inset-x-10">
          <p className="font-mono text-[10px] tracking-[.16em] text-amber">MACHINES / UNDER YOUR DIRECTION</p>
          <p className="mt-3 max-w-md text-2xl font-medium leading-tight tracking-tight lg:text-3xl">Build Machines that live on the internet.</p>
          <p className="mt-4 font-mono text-[9px] tracking-wider text-mute">CONCEPTUAL MACHINE FIELD</p>
        </div>
      </div>
    </main>
  );
}
