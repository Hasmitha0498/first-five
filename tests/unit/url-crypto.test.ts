import { describe, expect, it } from "vitest";
import { generateInvitationCode, normalizeInvitationCode, publicId } from "../../apps/server/src/lib/crypto";
import { normalizeWebsiteUrl, pathsEqual, sanitizeLabel, sanitizePath } from "../../apps/server/src/lib/url";

describe("website URL validation", () => {
  const prod = { allowLocalhost: false };
  it("normalizes and derives the origin", () => {
    expect(normalizeWebsiteUrl("acme.app/home?x=1#y", prod)).toEqual({ url: "https://acme.app/home", origin: "https://acme.app" });
  });
  it.each([
    ["http://acme.app", "secure"],
    ["https://user:pw@acme.app", "username"],
    ["https://localhost:3000", "localhost"],
    ["https://10.0.0.5", "IP address"],
    ["https://intranet", "complete domain"],
    ["ftp://acme.app", "secure"],
  ])("rejects %s", (input, msg) => {
    expect(() => normalizeWebsiteUrl(input, prod)).toThrow(new RegExp(msg, "i"));
  });
  it("allows http://localhost only in development", () => {
    expect(normalizeWebsiteUrl("http://localhost:5173", { allowLocalhost: true }).origin).toBe("http://localhost:5173");
  });
});

describe("event sanitization", () => {
  it("strips query strings and fragments and redacts identifiers from paths", () => {
    expect(sanitizePath("/reset?token=abc#x")).toBe("/reset");
    expect(sanitizePath("//users/jane@example.com/orders/12345678")).toBe("/users/:redacted/orders/:id");
  });
  it("collapses, caps and redacts labels", () => {
    expect(sanitizeLabel("  Email   me at a@b.co  ")).toBe("Email me at [redacted]");
    expect(sanitizeLabel("Card 4111 1111 1111 1111")).toBe("Card [redacted]");
    expect(sanitizeLabel("x".repeat(200))!.length).toBe(80);
    expect(sanitizeLabel("   ")).toBeNull();
  });
  it("compares paths ignoring trailing slashes", () => {
    expect(pathsEqual("/dashboard/", "/dashboard")).toBe(true);
    expect(pathsEqual("/", "/")).toBe(true);
    expect(pathsEqual("/a", "/b")).toBe(false);
  });
});

describe("identifiers and invitation codes", () => {
  it("generates prefixed public IDs", () => {
    expect(publicId("ffp")).toMatch(/^ffp_[a-z0-9]{20}$/);
    expect(new Set(Array.from({ length: 200 }, () => publicId("ffp"))).size).toBe(200);
  });
  it("generates 80-bit codes and normalizes user input", () => {
    const code = generateInvitationCode();
    expect(code).toMatch(/^FF-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(normalizeInvitationCode(code.toLowerCase())).toBe(normalizeInvitationCode(code));
    expect(normalizeInvitationCode(code.replace(/-/g, " "))).toBe(normalizeInvitationCode(code));
    expect(normalizeInvitationCode("ff-abcd-efgh-0000-1111")).toBe("ABCDEFGH00001111");
    expect(normalizeInvitationCode("ABCD-EFGH-OOOO-IIII")).toBe("ABCDEFGH00001111");
  });
});
