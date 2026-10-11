import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy aria-label="Loading Machine">
      <div className="flex items-center gap-4 border-b border-line pb-6"><Skeleton className="h-[52px] w-[52px]" /><div className="space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-3 w-32" /></div></div>
      <Skeleton className="h-11 w-full max-w-md" />
      <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
      <Skeleton className="h-28" />
      <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-[360px]" /><Skeleton className="h-[360px]" /></div>
    </div>
  );
}
