import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from "crypto";

// Phone numbers are personal data. They are stored encrypted (AES-256-GCM) so a database leak alone does not expose
// them, and looked up by a keyed hash (HMAC) so the same number can be recognised without decrypting anything.
// Both keys are derived from one secret, PII_ENCRYPTION_KEY (64 hex characters = 32 bytes):
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Losing the key means losing the ability to message existing subscribers. Back it up with your other secrets.

export class PiiKeyError extends Error {}

function masterKey(): Buffer {
  const hex = process.env.PII_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new PiiKeyError("PII_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(hex, "hex");
}

export const piiKeyConfigured = () => /^[0-9a-fA-F]{64}$/.test(process.env.PII_ENCRYPTION_KEY ?? "");

const derive = (purpose: string) => Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `floodwatch/${purpose}`, 32));

/** Encrypt a phone number. Output: v1.<iv>.<tag>.<ciphertext>, each base64url. A new random IV every time. */
export function encryptPhone(digits: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive("enc"), iv);
  const body = Buffer.concat([cipher.update(digits, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Decrypt. Throws if the value was changed or the key is wrong: GCM authenticates as well as encrypts. */
export function decryptPhone(token: string): string {
  const [version, iv, tag, body] = token.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", derive("enc"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

const mac = (message: string) => createHmac("sha256", derive("hash")).update(message).digest("hex");

/** Stable, keyed fingerprint of a phone number, for finding subscriptions and counting sends. Not reversible. */
export const hashPhone = (digits: string) => mac(`phone:${digits}`);

/** Keyed hash of a one-time code, bound to the phone it was sent to, so a code for one number cannot confirm another. */
export const hashCode = (phoneHash: string, code: string) => mac(`code:${phoneHash}:${code}`);

/** A 6-digit one-time code from a cryptographic random source. */
export const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
