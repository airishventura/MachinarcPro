import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Sign in");

export default async function Login({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const error = demo === "limited" ? "Too many demo sessions. Wait an hour and try again." : demo === "failed" ? "The demo could not be provisioned. Please try again." : null;
  return <AuthShell title="OPERATOR SIGN IN" sub="Access your Machines.">{error && <p role="alert" className="mb-4 border border-bad/40 bg-bad/10 px-3 py-2 font-mono text-xs text-bad">{error}</p>}<AuthForm mode="login" /></AuthShell>;
}
