import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Create account");

export default function Register() {
  return <AuthShell title="CREATE OPERATOR ACCOUNT" sub="A beta workspace with example Machines and internal Credits. Registration does not include hosted real AI."><AuthForm mode="register" /></AuthShell>;
}
