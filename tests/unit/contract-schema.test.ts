/** Schema-level contract tests for the SDK event format (no SDK involved). */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EventBatchRequestSchema, SdkEventSchema } from "../../packages/sdk-contract/src";

const valid = {
  schema_version: 1,
  event_id: randomUUID(),
  event_name: "ff_element_clicked",
  project_id: "ffp_abcdefgh12345678",
  study_id: "ffs_abcdefgh12345678",
  session_id: "ffx_abcdefgh12345678",
  mode: "live",
  client_sequence: 17,
  timestamp: "2026-10-24T09:00:00Z",
  page_path: "/signup",
  element_id: "create_account",
  element_type: "button",
  element_label: "Create Account",
};

describe("SDK event schema v1", () => {
  it("accepts the canonical example", () => {
    expect(SdkEventSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects unknown fields (allowlist)", () => {
    expect(SdkEventSchema.safeParse({ ...valid, input_value: "secret" }).success).toBe(false);
  });
  it("rejects sensitive-looking property keys", () => {
    for (const key of ["password", "email", "card_number", "otp_code", "input_value"]) {
      expect(SdkEventSchema.safeParse({ ...valid, properties: { [key]: "x" } }).success, key).toBe(false);
    }
    expect(SdkEventSchema.safeParse({ ...valid, properties: { plan: "pro", step: 2 } }).success).toBe(true);
  });
  it("requires a UUID event_id and known event names", () => {
    expect(SdkEventSchema.safeParse({ ...valid, event_id: "123" }).success).toBe(false);
    expect(SdkEventSchema.safeParse({ ...valid, event_name: "keypress" }).success).toBe(false);
  });
  it("rejects paths that are not absolute", () => {
    expect(SdkEventSchema.safeParse({ ...valid, page_path: "https://x.com/a" }).success).toBe(false);
  });
  it("bounds batch size", () => {
    expect(EventBatchRequestSchema.safeParse({ schema_version: 1, events: [] }).success).toBe(false);
    expect(EventBatchRequestSchema.safeParse({ schema_version: 1, events: Array(51).fill(valid) }).success).toBe(false);
    expect(EventBatchRequestSchema.safeParse({ schema_version: 1, events: Array(50).fill(valid) }).success).toBe(true);
  });
});
