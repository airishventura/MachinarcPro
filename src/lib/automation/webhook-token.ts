import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Token format: whk_<prefix12>_<secret32>. Only the SHA-256 of the full token is stored. */
export function mintWebhookToken() {
  const prefix = randomBytes(6).toString("hex");
  const token = `whk_${prefix}_${randomBytes(24).toString("base64url")}`;
  return { token, prefix, hash: hashToken(token) };
}
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export function parseToken(t: string) { const m = /^whk_([0-9a-f]{12})_[A-Za-z0-9_-]{32}$/.exec(t); return m ? m[1] : null; }
export function tokenMatches(t: string, hash: string) {
  const a = Buffer.from(hashToken(t), "hex"), b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
