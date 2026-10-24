# PostHog dashboard metrics: implementation plan

Status: draft, awaiting user approval (2026-10-24).
Repo: `~/ws/first-five-app` (clean `main`, `bf0560c`). Branch: `feat/posthog-dashboard-metrics`.
Source of truth: `docs/First_Five_PRD_v1_1.md`. `[R]` = required by the PRD line cited; `[D]` = design choice.

## 0. What the PRD requires

| Ref | Requirement |
| --- | --- |
| L195, L303, L701 | [R] Postgres stays authoritative for counts and outcomes; PostHog supplies "richer click/journey details" |
| L395 (§7.3) | [R] Bounded HogQL with strict study **and** project filters, explicit study ID, time window, size cap; **cache recent responses**. Supplies: page/action timelines, distinct sessions clicking elements, alternative paths, error event counts, configured funnels "where useful" |
| L395, L303, A13 (L665) | [R] When PostHog is delayed or fails: show Postgres counts, mark the details `processing` / `temporarily unavailable` |
| L623 (W6) | [R] An analytics snapshot, signed and versioned, with event cutoff and data quality; the dashboard shows the last refresh |
| L399 (§7.4) | [R] Track delivery lag, rejections, duplicates, missing session IDs, filtered events, successful reads. Never claim "no errors" when `ff_client_error` isn't instrumented |
| L160 (§3.6) | [R] With milestones show the funnel; without them show page/action path observations, never invented steps |
| L302, L435 | [R] Deliver the outbox on the next worker job **or eligible app request**; don't rely on `setInterval` surviving free-instance sleep |
| L168 | [R] Empty states never fabricate numbers |

Out of scope: session drill-down from PostHog (L701; `getSessionDetail` keeps using Postgres `EventRecord`s), a dedicated Render worker service, and back-filling events sent before PostHog was configured.

## 1. Facts checked on 2026-10-24

- Render `first-five` (`srv-dbe9ofcs728c73bh695g`) is live on `bf0560c`. Env group `first-five-env` is linked and has `POSTHOG_HOST=https://us.i.posthog.com`, `POSTHOG_API_HOST=https://us.posthog.com`, `POSTHOG_PROJECT_ID=685148`, `POSTHOG_PROJECT_API_KEY` (phc_) and `POSTHOG_PERSONAL_API_KEY` (phx_). `PostHogAdapter.configured` and `canQuery` are therefore true in production.
- PostHog project 685148 holds **no** `ff_*` product events. The only one in the last 2 days is the manual `ff_setup_check`.
- HogQL `values` placeholders work: `{"kind":"HogQLQuery","query":"... IN {ids}","values":{"ids":[...]}}`. PostHog escaped `b' OR 1=1 --` safely. Use placeholders for **every** dynamic value; never interpolate.
- A 7-day `GROUP BY` without filters returned **504**. Queries must be study-filtered and time-bounded.
- `ff_client_error` is in `packages/sdk-contract/src/index.ts:56`, but SDK 0.1/0.2 never emits it.
- `ff_session_id` = `StudySession.publicId`; `ff_study_id` = `Study.publicId`; `ff_project_id` = `Project.publicId` (`sdk.ts:482-497`).

## 2. Tasks

### T1. Branch
```bash
cd ~/ws/first-five-app && git switch -c feat/posthog-dashboard-metrics
```

### T2. Prisma model: `AnalyticsSnapshot` [R L623]
Append to `prisma/schema.prisma`, and add `analyticsSnapshots AnalyticsSnapshot[]` to `model Study`:
```prisma
enum AnalyticsSnapshotStatus {
  ready
  processing
  unavailable
}

// Cached, signed PostHog read for one study version. Postgres stays authoritative for counts.
model AnalyticsSnapshot {
  id              String                  @id @default(uuid()) @db.Uuid
  studyId         String                  @db.Uuid
  studyVersion    Int
  status          AnalyticsSnapshotStatus @default(processing)
  cohortHash      String
  eventCutoff     DateTime?
  details         Json                    @default("{}")
  dataQuality     Json                    @default("{}")
  signature       String?
  lastError       String?
  computedAt      DateTime?
  refreshStartedAt DateTime?
  updatedAt       DateTime                @updatedAt

  study Study @relation(fields: [studyId], references: [id], onDelete: Cascade)

  @@unique([studyId, studyVersion])
  @@map("analytics_snapshots")
}
```
Run `npx prisma migrate dev --name analytics_snapshots`. Commit the generated `prisma/migrations/<ts>_analytics_snapshots/`.

### T3. Adapter: parameterised queries
In `apps/server/src/integrations/posthog.ts`:
- Change the signature to `query<T = unknown[]>(hogql: string, values?: Record<string, unknown>): Promise<T[]>`.
- Send `{ query: { kind: "HogQLQuery", query: hogql, ...(values ? { values } : {}) } }`.
- Add the same optional param to the `AnalyticsProvider` interface.
- Switch `verifyRoundTrip` to `{check_id}` with `values: { check_id: id }` and delete the `safeId` regex.

### T4. Service: `apps/server/src/services/posthog-metrics.ts` (new)
Exports `refreshAnalyticsSnapshot(ctx, studyId, version)` and `readAnalyticsSnapshot(ctx, studyId, version)`.

**Cohort** [D: the PostHog panel must match the Postgres cards next to it]
- Sessions with `studyId`, `studyVersion.version = version`, `isRepeat = false` and `status != invalid`.
- `cohort = publicIds.sort()`, `cohortHash = sha256(cohort.join(","))`.
- If `cohort.length === 0`: upsert `status=ready` with `details={}`, then return. The UI shows the existing empty state (L168).

**Common filter** [R L395]. Every query uses this `WHERE` clause and a `LIMIT`:
```ts
const W =
  "properties.ff_project_id = {project_id} AND properties.ff_study_id = {study_id} AND properties.ff_mode = 'live' " +
  "AND properties.ff_session_id IN {session_ids} AND timestamp >= toDateTime({from}) AND timestamp <= toDateTime({to})";
const values = { project_id, study_id, session_ids: cohort, from: fromIso, to: toIso };
```
`from` = the earliest cohort `startedAt` minus 5 minutes. `to` = `max(deadlineAt) + 10 minutes`, capped at now. Pass the timestamps as ISO strings.

**Queries.** All four were syntax-checked against PostHog project 685148 on 2026-10-24. Run them sequentially, each through `ctx.providers.analytics.query(sql, values)`:

| Key | PRD item | SQL | Cap |
| --- | --- | --- | --- |
| `elements` | distinct sessions clicking elements | `"SELECT properties.ff_page_path, properties.ff_element_key, any(properties.ff_element_label), uniq(properties.ff_session_id), count() FROM events WHERE event = 'ff_element_clicked' AND " + W + " GROUP BY 1, 2 ORDER BY 4 DESC, 5 DESC LIMIT 25"` | 25 |
| `timelines` | page/action timelines → alternative paths | `"SELECT sid, groupArray(tuple(seq, ev, path, el)) FROM (SELECT properties.ff_session_id AS sid, toInt(properties.ff_client_sequence) AS seq, event AS ev, properties.ff_page_path AS path, properties.ff_element_key AS el FROM events WHERE " + W + " ORDER BY sid, seq LIMIT 5000) GROUP BY sid LIMIT 200"`. Sort each session's array by `seq` in TS; `groupArray` order isn't guaranteed | 5000 events / 200 sessions |
| `counts` | data quality, successful reads | `"SELECT count(), uniq(properties.ff_session_id), max(timestamp) FROM events WHERE " + W`. With zero rows `max(timestamp)` is `1970-01-01T00:00:00Z`: treat it as `null` | 1 row |
| `errors` | error event counts | `"SELECT properties.ff_page_path, count(), uniq(properties.ff_session_id) FROM events WHERE event = 'ff_client_error' AND " + W + " GROUP BY 1 ORDER BY 2 DESC LIMIT 10"` | 10 |

**Derived in TypeScript from `timelines`** (pure functions in the same file):
- `paths`: for each session, take the `ff_page_viewed` page paths in sequence order and collapse consecutive duplicates. Group identical sequences and keep the top 5 by session count: `{ steps: string[], sessions: number, completed: number }`. `completed` comes from the Postgres session status.
- `transitions`: count `from→to` page pairs across sessions, as distinct sessions per pair. Keep the top 10.
- `lastStepBeforeDrop`: for Postgres `dropped` sessions only, the last page and element. Label it "last observed step", **never** "cause" (L164).

**Errors** [R L399]:
- `errorsInstrumented = rows.length > 0`.
- When it's false, store `errors: { instrumented: false }`. The UI says "Error tracking isn't instrumented on this site", **not** "no errors".

**Data quality** [R L399]:
- `postgresEvents` = Postgres `EventRecord` count for the cohort sessions.
- `posthogEvents` = `counts[0]`.
- `outbox` = `{pending, failed, dead}`: counts of `OutboxMessage` where `provider='posthog'` and `dedupeKey` starts with any cohort `publicId:`. Use one `groupBy` with `OR` of `startsWith`. Cohorts are ≤ participantLimit, so this stays small.
- `deliveryLagMs` = now − oldest pending `createdAt` (null if none).
- `missingInPosthog` = max(0, postgresEvents − posthogEvents).
- `sessionsWithoutEvents` = cohort size − `counts[1]`.

**Status**:
- `ready` when `missingInPosthog === 0` and `outbox.pending + outbox.failed === 0`.
- Otherwise `processing` (L303 data-delay).
- On any thrown error: `unavailable` with `lastError` (first 300 chars). **Keep the previous `details`**, so stale-but-labelled data still shows.

**Snapshot**:
- `eventCutoff = counts[0][2]` (max PostHog timestamp).
- `signature = HMAC-SHA256(SESSION_SECRET, JSON.stringify({studyId, version, cohortHash, eventCutoff, details}))`, hex [R L623 "signed"].
- `computedAt = now`, `refreshStartedAt = null`.

**Concurrency lease** [D]:
- Claim the refresh with `updateMany({ where: { id, OR: [{refreshStartedAt: null}, {refreshStartedAt: {lt: now-60s}}] }, data: { refreshStartedAt: now } })`. Proceed only if `count === 1`.
- Create the row first with `upsert` if it doesn't exist.

**Not configured**: if `!ctx.providers.analytics.canQuery`, upsert `status=unavailable`, `lastError="PostHog query access not configured"`, and return without querying.

### T5. Refresh triggers [R L302, L435]
- `readAnalyticsSnapshot` returns the row. It also returns `stale = !computedAt || now - computedAt > ANALYTICS_SNAPSHOT_TTL_SECONDS*1000 || row.cohortHash !== currentCohortHash`.
- In `getDashboard` (`apps/server/src/services/dashboard.ts`), after `loadSessions`:
  1. `void dispatchOutbox(ctx, 200).catch(() => {})`. This is the "eligible app request" delivery from L302.
  2. Read the snapshot. If it's stale, `void refreshAnalyticsSnapshot(ctx, owned.id, v).catch(err => ctx.log.warn(...))`. **Never await HogQL in the request.**
- In `runMaintenance` (`services/maintenance.ts`): after `dispatchOutbox`, refresh stale snapshots for studies with `status: "active"`, at most 5 per run, sequentially.
- `apps/server/src/config.ts`: add `ANALYTICS_SNAPSHOT_TTL_SECONDS: z.coerce.number().int().positive().default(300)` and a line in `.env.example`.

### T6. Dashboard contract
In `packages/shared/src/types.ts`, change `DashboardResponse.analytics` to:
```ts
analytics: {
  provider: "postgres" | "posthog";
  posthogStatus: ProviderStatus;
  details: {
    status: "ready" | "processing" | "unavailable" | "not_configured";
    computedAt: string | null;
    eventCutoff: string | null;
    elements: { path: string; elementKey: string; label: string | null; sessions: number; clicks: number }[];
    paths: { steps: string[]; sessions: number; completed: number }[];
    transitions: { from: string; to: string; sessions: number }[];
    lastStepBeforeDrop: { sessionPublicId: string; path: string | null; elementKey: string | null }[];
    errors: { instrumented: false } | { instrumented: true; byPath: { path: string; count: number; sessions: number }[] };
    dataQuality: { postgresEvents: number; posthogEvents: number; missingInPosthog: number; sessionsWithoutEvents: number; outbox: { pending: number; failed: number; dead: number }; deliveryLagMs: number | null };
  } | null;
};
```
- In `getDashboard`, set `provider: "posthog"` only when `details.status === "ready"`; otherwise use `"postgres"`.
- Set `details: null` when no snapshot row exists yet.
- `metrics`, `behavior.topPages` and `behavior.funnel` stay on Postgres, unchanged [R L195, L357].

### T7. UI: `apps/web/src/pages/app/TestOverview.tsx`
Replace the line-169 note with an "Observed paths (PostHog)" section, rendered when `d.analytics.details` is set:
- **Header line:** "PostHog · updated {relative computedAt} · events through {eventCutoff}" [R L623].
- **Status badges:**
  - `processing`: "Processing: {missingInPosthog} events still arriving".
  - `unavailable`: "Detailed analysis temporarily unavailable. Counts above are from First Five" [R A13].
  - `not_configured`: keep the old note.
- **Paths:** when `behavior.funnel` is null, show the top paths as `step → step` with "{sessions} of {cohort}" and "{completed} completed" [R L160]. When a funnel exists, show paths under it as "Alternative paths".
- **Elements:** clicked elements with distinct-session counts.
- **Last observed step** for dropped attempts, with this exact copy: "Last observed step (not necessarily the cause)" [R L164].
- **Errors:** if `instrumented: false`, show "Error tracking isn't instrumented on this site" [R L399].
- Use the existing `Card` component and Tailwind tokens from the surrounding sections. Add no new dependencies.

### T8. Event mapping
In `mapToPostHogEvent`, add `ff_study_version: number | null`. Add it to `FirstFiveEventForAnalytics`, and pass `r.session?.studyVersion.version ?? null` from `enqueueAnalytics` (`sdk.ts:469`), adding the `studyVersion` include where `r.session` is loaded. This is for future events only; the cohort filter in T4 doesn't depend on it.

### T9. Docs
- `docs/integrations/POSTHOG_SETUP.md` §1: replace "Future reads" with the snapshot design, TTL, statuses and data-quality fields. §8: add `analytics_snapshots.last_error`.
- `IMPLEMENTATION_STATUS.md` lines 22 and 25, and the `INTEGRATION_CHECKLIST.md` PostHog row: state what is implemented and what is verified. Mark it **Verified** only after T10.

### T10. Verify end to end (no fabricated data)
1. Run `npm run typecheck && npm run lint && npm test`. All must pass.
2. **User:** `/app/admin` → PostHog → Run verification. Expect `verification_pending`, then **Verified** after about 5 minutes (the first event took about 317 s).
3. Local run against real PostHog:
   - Use a `.env` with the same `POSTHOG_*` values; the user pastes them, Claude never prints them.
   - Create a project, a study and a real invite through the UI.
   - Do one live attempt with the SDK branch build (`~/ws/first-five-sdk`, contract v1) on `dev/demo-host`.
   - Wait about 5 minutes and open the dashboard.
   - Expect `processing` → `ready`, `posthogEvents == postgresEvents`, and the paths to match the session timeline.
4. Stop PostHog access (unset `POSTHOG_PERSONAL_API_KEY` locally) and confirm that counts render, the details show "temporarily unavailable", and the previous details are kept [R A13].

### T11. CHECKPOINT: show the user
Show the diff summary, the migration, the T10 evidence (screenshots and HogQL counts) and the docs. **Push, PR and deploy only after explicit approval.** The repo is `Hasmitha0498/first-five`, and Render deploys `main`.

## 3. Risks

1. **Conflicts with the uncommitted AgenticOrg work** in `~/ws/first-five-render` (`feat/agenticorg-ux-director`): it touches `maintenance.ts`, `schema.prisma`, `types.ts`, `registry.ts` and `config.ts`. Keep edits additive; the second branch to merge rebases and regenerates its migration.
2. **No live data yet.** T10.3 depends on the contract-v1 SDK branch being runnable locally. The published 0.1.0 uses the old contract.
3. **PostHog ingestion lag** (about 5 minutes for the first event) means `processing` is the normal first state, not a bug.
4. **Free Render instance sleep** pauses `runMaintenance`. The dashboard-request triggers in T5 cover this (L302).
5. **HogQL rate limits.** There are at most 4 queries per refresh, one refresh per study per TTL, and a lease prevents stampedes.

## Haiku Validation

Every task names the exact files, model and field names, SQL text with placeholder names, caps (25 / 5000 / 200 / 10 / top 5 / top 10 / 5 per maintenance run), TTL (300 s), lease (60 s), status rules, UI copy and commands. Haiku can carry out T1–T9 in order with no design decisions, and must stop at T10.2 (the user clicks verification) and at T11 (user approval before push or deploy).
