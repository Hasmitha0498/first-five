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
