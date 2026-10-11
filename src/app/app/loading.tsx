import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading">
      <div className="space-y-2 border-b border-line pb-6"><Skeleton className="h-3 w-40" /><Skeleton className="h-7 w-64" /><Skeleton className="h-3 w-52" /></div>
      <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="space-y-2 bg-bg3 p-4"><Skeleton className="h-2.5 w-20" /><Skeleton className="h-6 w-16" /></div>)}</div>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
    </div>
  );
}
