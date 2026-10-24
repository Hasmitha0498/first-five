import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Opaque bearer secret (256 bits), URL-safe. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Public, non-secret identifiers such as ffp_…, ffs_…, ffx_…. */
export function publicId(prefix: "ffp" | "ffs" | "ffx" | "p", length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return `${prefix}_${out}`;
}

// Crockford base32 without I, L, O, U to avoid transcription errors.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Invitation code: FF-XXXX-XXXX-XXXX-XXXX (80 bits of entropy). */
export function generateInvitationCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    groups.push(s);
  }
  return `FF-${groups.join("-")}`;
}

/** Canonical form used for hashing: uppercase, no separators, common look-alikes mapped. */
export function normalizeInvitationCode(input: string): string {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return s.length === 18 && s.startsWith("FF") ? s.slice(2) : s;
}
