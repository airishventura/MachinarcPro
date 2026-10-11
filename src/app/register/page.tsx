import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Create account");

export default function Register() {
  return <AuthShell title="CREATE OPERATOR ACCOUNT" sub="A workspace with demo Machines and 500 Credits is provisioned instantly."><AuthForm mode="register" /></AuthShell>;
}
