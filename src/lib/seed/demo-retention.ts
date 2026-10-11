export const DEMO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const VISITOR_DEMO_EMAIL_PATTERN = "^demo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@machinarc[.]invalid$";

export function visitorDemoExpiresAt(user: { email: string; passwordHash: string | null; googleId: string | null; createdAt: Date }) {
  if (user.passwordHash !== null || user.googleId !== null || !new RegExp(VISITOR_DEMO_EMAIL_PATTERN).test(user.email)) return null;
  return new Date(user.createdAt.getTime() + DEMO_RETENTION_MS);
}
