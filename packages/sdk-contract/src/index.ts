/**
 * First Five SDK ⇄ Render API contract, version 1.
 *
 * This package defines the wire contract only. The browser SDK itself is
 * developed in a separate codebase and is NOT implemented here.
 * See docs/integrations/SDK_INTEGRATION.md for the narrative specification.
 */
import { z } from "zod";

export const SDK_CONTRACT_VERSION = 1 as const;

/** Header carrying the scoped SDK credential obtained from /api/sdk/exchange. */
export const SDK_AUTH_HEADER = "authorization"; // value: `Bearer <credential>`

/** URL fragment keys the SDK reads on the customer website. */
export const HANDOFF_FRAGMENT_KEYS = {
  setup: "ff_setup",
  live: "ff_launch",
} as const;

/** Script tag attributes in the generated installation snippet. */
export const SNIPPET_ATTRIBUTES = {
  project: "data-firstfive-project",
  api: "data-firstfive-api",
} as const;

export const SDK_ENDPOINTS = {
  config: { method: "GET", path: "/api/sdk/config" },
  exchange: { method: "POST", path: "/api/sdk/exchange" },
  session: { method: "GET", path: "/api/sdk/session" },
  events: { method: "POST", path: "/api/sdk/events" },
  end: { method: "POST", path: "/api/sdk/session/end" },
  setupFinish: { method: "POST", path: "/api/sdk/setup/finish" },
} as const;

export const SDK_LIMITS = {
  maxEventsPerBatch: 50,
  maxBodyBytes: 64 * 1024,
  maxLabelLength: 80,
  maxPathLength: 512,
  maxPropertyKeys: 10,
  maxPropertyValueLength: 120,
  maxClockSkewSeconds: 300,
  /** Grace window after the deadline for events that occurred before it. */
  deadlineGraceSeconds: 15,
} as const;

// ───────────────────────────── Events ─────────────────────────────

export const SDK_EVENT_NAMES = [
  "ff_page_viewed",
  "ff_element_clicked",
  "ff_form_submitted",
  "ff_custom_event",
  "ff_activity",
  "ff_client_error",
  "ff_element_discovered",
  "ff_goal_reached",
] as const;
export type SdkEventName = (typeof SDK_EVENT_NAMES)[number];

/** Events accepted only in setup mode. */
export const SETUP_ONLY_EVENTS: readonly SdkEventName[] = ["ff_element_discovered"];

export const SdkModeSchema = z.enum(["setup", "live"]);
export type SdkMode = z.infer<typeof SdkModeSchema>;

export const ELEMENT_TYPES = ["button", "link", "submit", "role_button", "form", "custom", "other"] as const;

/** Property keys that must never be sent; the server rejects them. */
export const FORBIDDEN_PROPERTY_PATTERN =
  /pass(word)?|pwd|otp|token|secret|card|cvv|cvc|iban|ssn|aadhaar|pan_?number|email|phone|address|dob|birth|value|input/i;

const safeKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "property keys must be snake_case, ≤40 chars");
const safeValue = z.union([
  z.string().max(SDK_LIMITS.maxPropertyValueLength),
  z.number().finite(),
  z.boolean(),
]);

export const SafePropertiesSchema = z
  .record(safeKey, safeValue)
  .refine((o) => Object.keys(o).length <= SDK_LIMITS.maxPropertyKeys, {
    message: `at most ${SDK_LIMITS.maxPropertyKeys} properties`,
  })
  .refine((o) => Object.keys(o).every((k) => !FORBIDDEN_PROPERTY_PATTERN.test(k)), {
    message: "property key looks sensitive and is not allowed",
  });

export const SdkEventSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: z.string().uuid(),
    event_name: z.enum(SDK_EVENT_NAMES),
    project_id: z.string().regex(/^ffp_[a-z0-9]{8,40}$/),
    study_id: z.string().regex(/^ffs_[a-z0-9]{8,40}$/).optional(),
    session_id: z.string().regex(/^ffx_[a-z0-9]{8,40}$/).optional(),
    mode: SdkModeSchema,
    client_sequence: z.number().int().min(0).max(1_000_000),
    timestamp: z.string().datetime({ offset: true }),
    page_path: z.string().min(1).max(SDK_LIMITS.maxPathLength).startsWith("/").optional(),
    element_id: z.string().min(1).max(120).optional(),
    element_type: z.enum(ELEMENT_TYPES).optional(),
    element_label: z.string().max(200).optional(),
    custom_event_name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
    properties: SafePropertiesSchema.optional(),
  })
  .strict();
export type SdkEvent = z.infer<typeof SdkEventSchema>;

export const EventBatchRequestSchema = z
  .object({
    schema_version: z.literal(1),
    sdk_version: z.string().max(40).optional(),
    events: z.array(z.unknown()).min(1).max(SDK_LIMITS.maxEventsPerBatch),
  })
  .strict();
export type EventBatchRequest = { schema_version: 1; sdk_version?: string; events: SdkEvent[] };

export const EVENT_REJECTION_CODES = [
  "invalid_schema",
  "wrong_project",
  "wrong_study",
  "wrong_session",
  "wrong_mode",
  "setup_only_event",
  "clock_skew",
  "after_deadline",
  "session_finalized",
  "custom_event_not_allowed",
] as const;
export type EventRejectionCode = (typeof EVENT_REJECTION_CODES)[number];

export interface EventBatchResponse {
  /** Newly stored event IDs. */
  accepted: string[];
  /** Event IDs already stored earlier — acknowledged, never double-counted. Do not retry. */
  duplicates: string[];
  /** Permanently rejected events. Do not retry. */
  rejected: { event_id: string | null; code: EventRejectionCode; message: string }[];
  /** Live mode only: authoritative goal state after this batch committed. */
  goal: { verified: boolean; verified_event_id: string | null } | null;
  session_status: SessionStatus | null;
}

// ───────────────────────────── Sessions ─────────────────────────────

export type SessionStatus = "pending" | "completed" | "dropped" | "invalid";

export const ExchangeRequestSchema = z
  .object({
    project_id: z.string().regex(/^ffp_[a-z0-9]{8,40}$/),
    ticket: z.string().min(20).max(200),
    sdk_version: z.string().max(40).optional(),
  })
  .strict();
export type ExchangeRequest = z.infer<typeof ExchangeRequestSchema>;

export interface ExchangeResponse {
  credential: string;
  mode: SdkMode;
  expires_at: string;
  project_id: string;
  /** Live mode only. */
  study?: {
    study_id: string;
    session_id: string;
    task: string;
    deadline_at: string;
    goal_type: "element_clicked" | "page_reached" | "custom_event";
  };
  /** Setup mode only. */
  setup?: { setup_session_id: string; expires_at: string };
}

export interface SessionStateResponse {
  mode: SdkMode;
  project_id: string;
  expires_at: string;
  study?: ExchangeResponse["study"] & {
    status: SessionStatus;
    goal_verified: boolean;
    server_time: string;
  };
  setup?: { setup_session_id: string; status: "active" | "finished" | "expired" };
}

export const END_REASONS = ["finished", "gave_up", "consent_withdrawn"] as const;
export const EndRequestSchema = z.object({ reason: z.enum(END_REASONS) }).strict();
export type EndRequest = z.infer<typeof EndRequestSchema>;

export interface EndResponse {
  session_status: SessionStatus;
  final_reason: string | null;
  /** First-party First Five URL with a one-time feedback handoff in the fragment. Null when consent was withdrawn. */
  feedback_url: string | null;
}

export interface SdkConfigResponse {
  project_id: string;
  status: "active";
  contract_version: typeof SDK_CONTRACT_VERSION;
  api_base_url: string;
  allowed_origins: string[];
  event_allowlist: readonly SdkEventName[];
  allowed_custom_events: string[];
  limits: typeof SDK_LIMITS;
}

// ───────────────────────────── Errors ─────────────────────────────

export const SDK_ERROR_CODES = {
  invalid_request: 400,
  unauthenticated: 401,
  origin_not_allowed: 403,
  credential_scope: 403,
  not_found: 404,
  state_conflict: 409,
  ticket_expired: 410,
  ticket_consumed: 410,
  session_expired: 410,
  payload_too_large: 413,
  unsupported: 422,
  rate_limited: 429,
} as const;
export type SdkErrorCode = keyof typeof SDK_ERROR_CODES;

export interface SdkErrorResponse {
  error: { code: SdkErrorCode | string; message: string };
}
