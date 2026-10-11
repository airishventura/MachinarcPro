"use client";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="border border-bad/40 bg-bad/5 p-6 md:p-8" role="alert">
      <div className="t-section !text-bad">RUNTIME FAULT</div>
      <p className="t-secondary mt-2 max-w-md">This view could not load its telemetry. Your Machines are unaffected. Retry, or return to the Command Center.</p>
      {error.digest && <p className="t-caption mt-2">REF {error.digest}</p>}
      <div className="mt-6 flex gap-2"><button onClick={reset} className="btn btn-primary">Retry</button><Link href="/app" className="btn">Command Center</Link></div>
    </div>
  );
}
