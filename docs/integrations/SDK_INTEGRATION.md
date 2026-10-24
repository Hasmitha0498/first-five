# First Five SDK ⇄ Render API — Integration Contract (v1)

> **Audience:** the developer of the separately built First Five browser SDK.
> **Scope:** everything the SDK needs from the Render backend. This repository does **not** contain or host the SDK.
> **Source of truth in code:** [`packages/sdk-contract/src/index.ts`](../../packages/sdk-contract/src/index.ts) (TypeScript types + Zod schemas).
> **Machine-readable:** [`docs/api/sdk-openapi.yaml`](../api/sdk-openapi.yaml).
> **Executable contract tests:** [`tests/contract/sdk-contract.test.ts`](../../tests/contract/sdk-contract.test.ts). These use hand-built fixtures; they show the backend honours this contract and do **not** prove the real SDK works.

---

## 1. What the SDK does vs. what Render does

| SDK (separate project) | Render backend (this repo) |
|---|---|
| Loads from one shared, externally hosted URL (`SDK_SCRIPT_URL`) | Generates the per-project `<script>` snippet |
| Reads `data-firstfive-project` / `data-firstfive-api` | Issues public project IDs (`ffp_…`) — **not secrets** |
| Reads one-time handoff tickets from the URL fragment, then strips them | Issues tickets, exchanges them once, enforces origin allowlists |
| Observes pages/clicks/forms (never values) and batches events | Validates, sanitizes, de-duplicates and stores events |
| Shows the task control ("I'm stuck", "Finish test") | Owns the authoritative session state machine in PostgreSQL |
| Calls `end` and redirects the participant to `feedback_url` | Verifies goals, finalizes outcomes, issues the feedback handoff |

The client is **never** the source of truth for an outcome. `ff_goal_reached` is a hint only.

## 2. Installation snippet

```html
<script
  async
  src="https://YOUR-SDK-HOST/v1/firstfive.js"
  data-firstfive-project="ffp_xxxxxxxxxxxxxxxxxxxx"
  data-firstfive-api="https://first-five.onrender.com">
</script>
```

- `src` = `SDK_SCRIPT_URL` (same bundle for every customer). While unset, the app labels the snippet **Setup preview**.
- `data-firstfive-project` = public project ID. Only identifies the project; never authorizes anything.
- `data-firstfive-api` = Render base URL for all API calls below.

## 3. Modes and state machine

```
UNINITIALIZED → CONFIG_LOADING → READY            (no behavioral tracking)
READY → SETUP_ACTIVE   after exchanging a #ff_setup=… ticket
READY → LIVE_ACTIVE    after exchanging a #ff_launch=… ticket (participant consented on First Five)
SETUP_ACTIVE → READY   on POST /api/sdk/setup/finish or credential expiry
LIVE_ACTIVE → TASK_FINALIZING → FEEDBACK_HANDOFF → STOPPED
ANY ACTIVE → STOPPED   on consent withdrawal, 410 responses, or expiry
```

- **Setup** and **live** events are separate: a setup credential can only send `mode: "setup"` events without `study_id`/`session_id`; a live credential only `mode: "live"` events for its own study/session.
- With no credential the SDK must not send behavioral events.

## 4. Handoff tickets (cross-domain, no third-party cookies)

| Fragment key | Issued by | TTL | Use |
|---|---|---|---|
| `#ff_setup=<ticket>` | Builder clicks "Open my website" (`POST /api/projects/:id/setup-sessions`) | 10 min, setup session 30 min | Exchange once for a **setup** credential |
| `#ff_launch=<ticket>` | Participant consents (`POST /api/public/studies/:id/attempts`) | min(10 min, task deadline) | Exchange once for a **live** credential |

SDK requirements:
1. On load, read `location.hash`. If it contains `ff_setup` or `ff_launch`, **immediately** remove it with `history.replaceState(null, "", location.pathname + location.search)` before any app router reads it, then exchange it.
2. Tickets are single-use; a second exchange returns `410 ticket_consumed`.
3. Fragments are never sent to servers or in `Referer`; keep it that way (don't copy tickets into query strings, logs or analytics).
4. Store the returned **credential** in `sessionStorage` on the customer origin (per-tab, cleared on close). Use it to restore the session after reloads and SPA navigation via `GET /api/sdk/session`. Never put it in a URL. Never send it to PostHog.
5. If the customer's router uses hash routing and conflicts, report it to the First Five team; do not move tickets to query strings without a tested change to this contract.

## 5. Endpoints

All endpoints are under `data-firstfive-api`. JSON in/out. No cookies (`credentials: "omit"`). Authenticated calls use `Authorization: Bearer <credential>`.

### 5.1 `GET /api/sdk/config?project_id=ffp_…&sdk_version=1.2.3`
Public, non-secret configuration. Calling it from an allowed origin records an *installation ping* (the app shows "Verification needed"); it does **not** mark the website as connected.

`200`
```json
{
  "project_id": "ffp_…",
  "status": "active",
  "contract_version": 1,
  "api_base_url": "https://first-five.onrender.com",
  "allowed_origins": ["https://acme.app"],
  "event_allowlist": ["ff_page_viewed", "ff_element_clicked", "ff_form_submitted", "ff_custom_event", "ff_activity", "ff_client_error", "ff_element_discovered", "ff_goal_reached"],
  "allowed_custom_events": [],
  "limits": { "maxEventsPerBatch": 50, "maxBodyBytes": 65536, "maxLabelLength": 80, "maxPathLength": 512, "maxPropertyKeys": 10, "maxPropertyValueLength": 120, "maxClockSkewSeconds": 300, "deadlineGraceSeconds": 15 }
}
```
Errors: `403 origin_not_allowed` (also shown to the builder as a connection issue), `404 not_found`.

### 5.2 `POST /api/sdk/exchange`
```json
{ "project_id": "ffp_…", "ticket": "<from fragment>", "sdk_version": "1.2.3" }
```
The request `Origin` must be one of the project's registered origins.

`200` (setup)
```json
{ "credential": "…", "mode": "setup", "expires_at": "…", "project_id": "ffp_…", "setup": { "setup_session_id": "…", "expires_at": "…" } }
```
`200` (live)
```json
{ "credential": "…", "mode": "live", "expires_at": "…", "project_id": "ffp_…",
  "study": { "study_id": "ffs_…", "session_id": "ffx_…", "task": "Create an account and reach the dashboard.", "deadline_at": "…", "goal_type": "page_reached" } }
```
Errors: `400 invalid_request`, `403 origin_not_allowed`, `404 not_found`, `410 ticket_consumed | ticket_expired | session_expired`, `429 rate_limited`.

The live credential stays valid until `deadline_at + 10 min` so the SDK can flush and end; it is revoked when the task ends.

### 5.3 `GET /api/sdk/session` (Bearer)
Recovery after reload/navigation, and goal acknowledgement polling.
```json
{ "mode": "live", "project_id": "ffp_…", "expires_at": "…",
  "study": { "study_id": "ffs_…", "session_id": "ffx_…", "task": "…", "deadline_at": "…", "goal_type": "page_reached",
             "status": "pending", "goal_verified": false, "server_time": "…" } }
```
Use `server_time` to correct the countdown for client clock skew. `status ≠ pending` ⇒ stop observing and offer feedback (call `end` to get the handoff).

### 5.4 `POST /api/sdk/events` (Bearer)
```json
{ "schema_version": 1, "sdk_version": "1.2.3", "events": [ /* 1–50 events */ ] }
```
Body ≤ 64 KB (`413 payload_too_large`). Per-credential rate limit 120 requests/min.

`200` (or `422` when every event was rejected)
```json
{
  "accepted":   ["<event_id>", "…"],
  "duplicates": ["<event_id>"],
  "rejected":   [{ "event_id": "…", "code": "invalid_schema", "message": "…" }],
  "goal": { "verified": true, "verified_event_id": "<event_id>" },
  "session_status": "completed"
}
```
- **Retry policy:** retry the whole batch only on network errors, `429` and `5xx` (exponential backoff, keep the same `event_id`s). `accepted` and `duplicates` are durably stored; never resend them. `rejected` are permanent; drop them.
- `goal` / `session_status` are `null` in setup mode.
- A response is sent only after the PostgreSQL transaction commits.

Rejection codes: `invalid_schema`, `wrong_project`, `wrong_study`, `wrong_session`, `wrong_mode`, `setup_only_event`, `clock_skew`, `after_deadline`, `session_finalized`, `custom_event_not_allowed`.

### 5.5 `POST /api/sdk/session/end` (Bearer, live only)
```json
{ "reason": "finished" }        // "finished" | "gave_up" | "consent_withdrawn"
```
`200`
```json
{ "session_status": "completed", "final_reason": "goal_verified", "feedback_url": "https://first-five.onrender.com/t/ffs_…/feedback#h=…" }
```
- **Finalization contract:** before calling `end`, the SDK MUST flush every buffered event and wait for its `/events` response. The server decides the outcome only from what it has accepted:
  - goal already verified → `completed` (unchanged);
  - `finished` without a verified goal → `dropped / finished_without_goal`;
  - `gave_up` ("I'm stuck") → `dropped / explicit_stop`;
  - after the deadline → `dropped / deadline`;
  - `consent_withdrawn` → `invalid / consent_withdrawn`, stored events and answers deleted, `feedback_url: null`.
- `end` is idempotent; repeated calls return the same final state and a fresh `feedback_url`.
- After `end`, the credential is revoked (`410 session_expired`). Stop listeners, remove the widget, clear `sessionStorage`, then `location.assign(feedback_url)`.

### 5.6 `POST /api/sdk/setup/finish` (Bearer, setup only)
Ends the builder's walkthrough and revokes the setup credential. `200 { "status": "finished" }`.

## 6. Canonical event schema v1

```json
{
  "schema_version": 1,
  "event_id": "8a6e0804-2bd0-4672-b79d-d97027f9071a",
  "event_name": "ff_element_clicked",
  "project_id": "ffp_…",
  "study_id": "ffs_…",
  "session_id": "ffx_…",
  "mode": "live",
  "client_sequence": 17,
  "timestamp": "2026-10-24T09:00:00.000Z",
  "page_path": "/signup",
  "element_id": "create-account",
  "element_type": "button",
  "element_label": "Create Account",
  "custom_event_name": "signup_completed",
  "properties": { "step": 2 }
}
```

| Field | Rules |
|---|---|
| `schema_version` | `1` |
| `event_id` | UUID, unique per event; used for de-duplication. Reuse it on retries. |
| `event_name` | One of the allowlist (below) |
| `project_id` | Must equal the credential's project |
| `study_id`, `session_id` | Live only, must equal the credential's; **must be absent** in setup |
| `mode` | `setup` or `live`, must equal the credential's mode |
| `client_sequence` | Integer, strictly increasing per credential; used for ordering |
| `timestamp` | ISO-8601 with offset. Future skew > 300 s is rejected; live events earlier than task start − 300 s are rejected |
| `page_path` | Starts with `/`. Server strips query strings and fragments and redacts email-like or long numeric segments |
| `element_id` | Stable key: prefer `data-firstfive-id`; otherwise a best-effort selector key (≤120 chars) |
| `element_type` | `button`, `link`, `submit`, `role_button`, `form`, `custom`, `other` |
| `element_label` | Visible text only (≤200 in, stored ≤80, emails/card-like numbers redacted). **Never input values** |
| `custom_event_name` | Required for `ff_custom_event`, `snake_case` |
| `properties` | ≤10 keys, `snake_case`, values string ≤120 / number / boolean. Keys matching password, otp, token, secret, card, cvv, iban, ssn, email, phone, address, dob, value, input… are rejected |

Unknown fields are rejected (`invalid_schema`).

### Allowed events

| Event | Mode | Notes |
|---|---|---|
| `ff_page_viewed` | both | Initial load, `pushState`, `replaceState`, `popstate` |
| `ff_element_clicked` | both | In setup, marks the element as *clicked* in the catalog |
| `ff_form_submitted` | both | Safe form ID only, never values |
| `ff_custom_event` | both | App-instrumented outcomes like `signup_completed` |
| `ff_activity` | both | Throttled liveness/visibility |
| `ff_client_error` | both | Sanitized error type + route |
| `ff_element_discovered` | **setup only** | DOM scan of available buttons/links (available ≠ clicked) |
| `ff_goal_reached` | live | **Hint only** — never completes a session |

## 7. Goal verification (server-side)

| Goal type | Completes when an accepted live event… |
|---|---|
| `page_reached` | is `ff_page_viewed` with `page_path` equal to the target (trailing slash ignored) |
| `element_clicked` | is `ff_element_clicked` with `element_id` equal to the target (and on the configured page, if set) |
| `custom_event` | is `ff_custom_event` with `custom_event_name` equal to the target |

…and its `timestamp` ≤ deadline **and** it is received ≤ deadline + 15 s. A matching event outside that window is not counted and the session is flagged `late_goal_event`. Completion is an atomic `UPDATE … WHERE status = 'pending'`; concurrent goal/timeout/end requests cannot double-finalize. Custom events are telemetry from the customer's frontend, not audited transactions.

## 8. Session states (authoritative, PostgreSQL)

| State | Meaning |
|---|---|
| `pending` | Started; no outcome yet |
| `completed` | Goal verified within the window |
| `dropped` | Explicit stop, finished without goal, or deadline passed |
| `invalid` | Website never exchanged the launch ticket by the deadline (`launch_not_exchanged`), or consent withdrawn |

Deadlines are reconciled by the server every minute and on demand before every relevant read; no browser event is required.

## 9. CORS and Content Security Policy

- CORS: `Access-Control-Allow-Origin` is returned only for origins registered on a First Five project (builders manage them in **Website → Settings**). Each endpoint additionally enforces the specific project's allowlist. Allowed headers: `content-type, authorization`. No credentials/cookies.
- Origin checks are defence in depth; the tickets and credentials are the actual authorization.
- Customer CSP must allow:
  ```
  script-src  'self' https://YOUR-SDK-HOST;
  connect-src 'self' https://first-five.onrender.com;
  ```

## 10. Privacy rules the SDK must follow

- Never read or send input/textarea/select values, passwords, OTPs, card fields or anything in payment iframes.
- Do not observe anything without a setup or live credential (no always-on tracking).
- Exclude elements marked `data-firstfive-ignore` and sensitive containers from discovery.
- Do not enable PostHog autocapture or session replay; Render forwards sanitized events to PostHog itself, using `ff_session_id` (never `$session_id`).

## 11. Error format

```json
{ "error": { "code": "ticket_expired", "message": "This link has expired." } }
```
| HTTP | Codes |
|---|---|
| 400 | `invalid_request` |
| 401 | `unauthenticated` |
| 403 | `origin_not_allowed`, `credential_scope` |
| 404 | `not_found` |
| 409 | `state_conflict` |
| 410 | `ticket_consumed`, `ticket_expired`, `session_expired` |
| 413 | `payload_too_large` |
| 422 | all events in batch rejected (see per-event codes) |
| 429 | `rate_limited` |

## 12. How to verify a real SDK build against this backend

1. Configure `SDK_SCRIPT_URL` on Render and redeploy; the install page stops showing "Setup preview".
2. Install the snippet on a test site whose origin is registered on a project.
3. In First Five: **Website → Journey → Open my website**. Walk the flow. The website must turn **Connected** and pages/elements must appear.
4. Create and launch a test; open the test link in a private window; consent; complete the task; confirm the session shows **Completed** with a goal-verified event, and the feedback page loads.
5. Repeat with "I'm stuck", with a reload mid-task, and with the tab closed until the deadline.
6. Record results in `INTEGRATION_CHECKLIST.md`. Only then mark the SDK as connected.
