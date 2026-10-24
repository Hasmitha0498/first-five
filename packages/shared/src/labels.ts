/** Customer-facing, plain-language labels for internal states. */

export const INTEGRATION_STATUS_LABELS = {
  setup_not_started: "Setup not started",
  awaiting_connection: "Waiting for connection",
  verification_needed: "Verification needed",
  connected: "Connected",
  connection_issue: "Connection issue",
} as const;

export const INTEGRATION_STATUS_HELP = {
  setup_not_started: "Add the First Five code to your website to begin.",
  awaiting_connection: "We haven't received activity from your website yet.",
  verification_needed:
    "Your website loaded First Five. Walk through your journey once so we can confirm activity is arriving.",
  connected: "We're receiving activity from your website.",
  connection_issue: "We received activity we couldn't accept. Check the details below.",
} as const;

export const STUDY_STATUS_LABELS = {
  draft: "Draft",
  ready: "Ready",
  active: "Active",
  paused: "Paused",
  full: "Full",
  closed: "Closed",
  expired: "Expired",
} as const;

export const SESSION_STATUS_LABELS = {
  pending: "Still in progress",
  completed: "Completed",
  dropped: "Didn't complete",
  invalid: "Excluded",
} as const;

export const FINAL_REASON_LABELS: Record<string, string> = {
  goal_verified: "Reached the goal",
  explicit_stop: "Said they were stuck",
  finished_without_goal: "Finished without reaching the goal",
  deadline: "Ran out of time",
  launch_not_exchanged: "Website never confirmed the test started",
  consent_withdrawn: "Withdrew consent",
};

export const FEEDBACK_STATUS_LABELS = {
  not_prompted: "Not asked yet",
  awaiting: "Waiting for answers",
  submitted: "Feedback given",
  skipped: "Skipped",
  unavailable: "No feedback",
} as const;

export const GOAL_TYPE_LABELS = {
  element_clicked: "A specific button or link was clicked",
  page_reached: "A destination page was reached",
  custom_event: "A custom completion event occurred",
} as const;

export const GOAL_TYPE_SHORT = {
  element_clicked: "Click outcome",
  page_reached: "Page reached",
  custom_event: "Custom completion event",
} as const;

export const REPORT_STATUS_LABELS = {
  not_generated: "Not generated",
  processing: "Processing",
  draft: "Draft",
  awaiting_review: "Awaiting review",
  revision_requested: "Revision requested",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  failed: "Failed",
} as const;

export const EVIDENCE_STRENGTH_LABELS = {
  inconclusive: "Inconclusive",
  limited: "Limited evidence",
  supported: "Supported",
} as const;

export const PROVIDER_STATUS_LABELS = {
  not_configured: "Not configured",
  configured: "Configured",
  verification_pending: "Verification pending",
  verified: "Verified",
  error: "Degraded / Error",
} as const;

// ───────────────────────── Custom event labels ─────────────────────────

export type EventDetails = Record<string, string | number | boolean>;

/**
 * Property keys safe to show on the dashboard. Everything else a website sends with a
 * custom event (e.g. selected page text) is never returned by the API.
 */
export const DISPLAY_DETAIL_KEYS = [
  "cta",
  "label",
  "element",
  "field",
  "section",
  "depth",
  "from_depth",
  "max_depth",
  "hover_ms",
  "dwell_ms",
  "time_on_page_ms",
  "reason",
  "count",
  "ff_page",
  "product",
  "step",
  "plan",
] as const;

/** Keep only display-safe details (strings capped at 80 chars). */
export function pickDisplayDetails(props: unknown): EventDetails | null {
  if (!props || typeof props !== "object") return null;
  const out: EventDetails = {};
  for (const key of DISPLAY_DETAIL_KEYS) {
    const v = (props as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 80);
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

const seconds = (ms: unknown) => (typeof ms === "number" ? ` (${(ms / 1000).toFixed(1)}s)` : "");
const quoted = (v: unknown) => (typeof v === "string" && v ? `“${v}”` : "");

/** "cta_hesitate" -> "Cta hesitate" for names without a specific label. */
export function humanizeEventName(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Custom event";
}

/** Plain-language description of a website-reported (custom) event. */
export function describeCustomEvent(name: string | null | undefined, d: EventDetails | null | undefined): string {
  const x = d ?? {};
  const target = quoted(x.label) || quoted(x.cta) || quoted(x.element) || quoted(x.product);
  switch (name) {
    case "cta_view":
      return `Saw ${quoted(x.cta) || "a call to action"}`;
    case "cta_hover":
      return `Hovered over ${quoted(x.cta) || "a call to action"}${seconds(x.hover_ms)}`;
    case "cta_hesitate":
      return `Hesitated on ${quoted(x.cta) || "a call to action"}${seconds(x.dwell_ms)}`;
    case "cta_click":
      return `Clicked ${target || "a call to action"}`;
    case "element_click":
      return `Clicked ${target || "an element"}`;
    case "rage_click":
      return `Rage-clicked ${target || "an element"}${typeof x.count === "number" ? ` (${x.count}×)` : ""}`;
    case "scroll_depth":
      return typeof x.depth === "number" ? `Scrolled to ${x.depth}%` : "Scrolled down";
    case "scroll_reversal":
      return `Scrolled back up${typeof x.from_depth === "number" ? ` from ${x.from_depth}%` : ""}`;
    case "section_view":
      return `Viewed section ${quoted(x.section) || ""}`.trim();
    case "field_focus":
      return `Started field ${quoted(x.field) || ""}`.trim();
    case "field_complete":
      return `Filled in field ${quoted(x.field) || ""}`.trim();
    case "field_abandon":
      return `Left field ${quoted(x.field) || ""} empty`.replace("  ", " ");
    case "text_select":
      return "Selected text on the page";
    case "page_view":
      return `Page view reported by the website${typeof x.ff_page === "string" ? ` (${x.ff_page})` : ""}`;
    case "page_exit":
      return `Left the page${typeof x.reason === "string" ? ` (${x.reason.replace(/_/g, " ")})` : ""}`;
    case "identify":
      return "Entered contact details";
    default:
      return name ? `${humanizeEventName(name)}${target ? ` ${target}` : ""}` : "Custom event";
  }
}
