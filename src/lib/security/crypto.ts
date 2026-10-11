import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for integration credentials. Key: MARC_ENCRYPTION_KEY (32+ chars) in production.
// Development falls back to a key derived from DATABASE_URL so local setups work; never use that in production.
function key() {
  const k = process.env.MARC_ENCRYPTION_KEY;
  if (k && k.length >= 32) return createHash("sha256").update(k).digest();
  if (process.env.NODE_ENV === "production" && process.env.MARC_REQUIRE_ENCRYPTION_KEY === "1") throw new Error("MARC_ENCRYPTION_KEY is required");
  return createHash("sha256").update(`marc-dev:${process.env.DATABASE_URL ?? "local"}`).digest();
}
export const encryptionKeyConfigured = () => !!process.env.MARC_ENCRYPTION_KEY && process.env.MARC_ENCRYPTION_KEY.length >= 32;

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64") };
}
export function decrypt(x: { ciphertext: string; iv: string; tag: string }) {
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(x.iv, "base64"));
  d.setAuthTag(Buffer.from(x.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(x.ciphertext, "base64")), d.final()]).toString("utf8");
}
export const hintOf = (s: string) => (s.length > 8 ? `••••${s.slice(-4)}` : "••••");
