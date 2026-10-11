import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid-bg flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <div className="t-caption">ERR · 404</div>
        <h1 className="t-title mt-2">SIGNAL LOST</h1>
        <p className="t-secondary mt-2">This Machine or route does not exist in your workspace.</p>
        <Link href="/app" className="btn btn-primary mt-6">Return to Command Center</Link>
      </div>
    </main>
  );
}
