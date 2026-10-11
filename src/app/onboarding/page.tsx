import { requireSession } from "@/lib/auth";
import { Onboarding } from "@/components/onboarding";
import { privatePageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = privatePageMetadata("Onboarding");

export default async function OnboardingPage() {
  const { user } = await requireSession();
  return <Onboarding name={user.name} />;
}
