"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthorizationCard } from "@/components/machines/runtime-parts";
import type { ApprovalDTO } from "@/types/machine";

export function DashboardAuthorization({ a, machineName, machineId }: { a: ApprovalDTO; machineName: string; machineId: string }) {
  const r = useRouter();
  return <div className="space-y-1"><AuthorizationCard a={a} machineName={machineName} onDone={() => r.refresh()} /><Link href={`/app/machines/${machineId}`} className="t-caption hover:text-fg">OPEN {machineName} →</Link></div>;
}
