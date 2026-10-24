import { isIP } from "node:net";
import { AppError } from "./errors";

/**
 * Validates and normalizes a builder-supplied website address.
 * The server never fetches this URL (no SSRF surface); it is used only to
 * build participant launch links and the origin allowlist.
 */
export function normalizeWebsiteUrl(input: string, opts: { allowLocalhost: boolean }): { url: string; origin: string } {
  const raw = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw invalid("Enter a website address such as https://example.com");
  }
  const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.endsWith(".localhost");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLocal && opts.allowLocalhost)) {
    throw invalid("Use a secure https:// website address");
  }
  if (u.username || u.password) throw invalid("Website addresses can't include a username or password");
  if (isLocal && !opts.allowLocalhost) throw invalid("Use your public website address, not localhost");
  if (!isLocal) {
    if (isIP(u.hostname.replace(/^\[|\]$/g, ""))) throw invalid("Use your website's domain name rather than an IP address");
    if (!u.hostname.includes(".")) throw invalid("Enter a complete domain such as example.com");
  }
  u.hash = "";
  u.search = "";
  return { url: u.href, origin: u.origin };
}

export function normalizeOrigin(input: string, opts: { allowLocalhost: boolean }): string {
  return normalizeWebsiteUrl(input, opts).origin;
}

/** Strip query/fragment, collapse duplicate slashes, cap length. Never keeps query strings (may hold PII). */
export function sanitizePath(path: string): string {
  let p = path.split(/[?#]/)[0] ?? "/";
  p = p.replace(/\/{2,}/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  try {
    p = decodeURI(p);
  } catch {
    // keep encoded form
  }
  // Redact path segments that look like emails or long numeric identifiers.
  p = p
    .split("/")
    .map((seg) => (/@/.test(seg) ? ":redacted" : /^\d{6,}$/.test(seg) ? ":id" : seg))
    .join("/");
  return p.slice(0, 512);
}

/** Compare paths ignoring a trailing slash. */
export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const n = (s: string) => (s.length > 1 ? s.replace(/\/+$/, "") : s);
  return n(a) === n(b);
}

/** Collapse whitespace, cap length, redact email-like and long digit sequences. */
export function sanitizeLabel(label: string | undefined | null, max = 80): string | null {
  if (!label) return null;
  const cleaned = label
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted]")
    .replace(/\d[\d\s-]{7,}\d/g, "[redacted]");
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Remove control characters from participant free text (kept as plain text; rendered escaped). */
export function sanitizeParticipantText(text: string | undefined | null, max = 2000): string | null {
  if (text == null) return null;
  const cleaned = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function invalid(message: string) {
  return new AppError(400, "invalid_request", message, { websiteUrl: message });
}
