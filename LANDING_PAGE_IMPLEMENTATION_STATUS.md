# Landing Page & Access System — Implementation Status

Verified locally on 24 Oct 2026 (production build + embedded PostgreSQL 17, headless Google Chrome). **Not deployed to Render yet** (awaiting approval).
Screenshots: [`qa/screenshots/`](qa/screenshots/). Design reference: [`references/landing/`](references/landing/).

| Requirement | Implementation | Tests | Blockers / notes | Files / routes |
|---|---|---|---|---|
| Landing page matching approved PNG (hero, report illustration, trust line, problem, 4 steps, example report, pricing, FAQ, final CTA, footer) | Done — React/Tailwind components, no embedded screenshot, no DESIGN PREVIEW banner | e2e `landing-access` ✓; visual comparison vs `firstfive_landing_full.png` reviewed | Problem section uses the spec's final copy (concise) instead of the PNG's two cards — intentional | `apps/web/src/pages/public/Landing.tsx`, `/` |
| Exact approved copy & CTA labels | Done | e2e asserts headline, eyebrow, CTAs | — | `Landing.tsx` |
| Illustrative data labeled | Done — "Sample data", "Illustrative", "Illustrative example. All data and quotations are fictional." | e2e ✓ | — | `Landing.tsx`, `/sample-report` |
| Navigation (How it works / Example report / Pricing / Sign in / Get access), mobile menu | Done, smooth scroll respects reduced motion | e2e (pricing scroll, mobile menu) ✓ | — | `components/layouts.tsx` |
| Paid CTA vs waitlist CTA lead to different flows | Done — `/access` vs `/waitlist` | e2e ✓ | — | — |
| Waitlist form (name, email, optional product + URL) | Done — validation, honeypot, rate limit 8/h/IP, keeps input on error | integration ✓, e2e ✓ | No email is sent (no email service) — page doesn't claim one | `/waitlist`, `POST /api/waitlist`, `routes/growth.ts` |
| Waitlist persistence & dedupe | `waitlist_leads` (normalized unique email, UTM, source, referrer, notice version, submission count) | integration ✓ (record, dedupe, no account/grant) | — | `prisma/schema.prisma` |
| Confirmation only after DB success | `/waitlist/success` requires router state from a confirmed submit; direct visits redirect | e2e ✓ | — | `/waitlist/success` |
| ₹99 offer page | Done — truthful availability, invitation-code & sign-in links | e2e ✓ | — | `/access` |
| Signup/login reuse with safe `next` redirects | Done — single auth system; internal-path-only redirects | e2e ✓ | Password reset by email not available (no email service) | `/signup`, `/login` |
| Pine Labs checkout | Interface + order/payment/webhook model; checkout opens only if `PAYMENTS_ENABLED=true` **and** adapter implemented + configured | integration ✓ (closed even with credentials; unverified order can't grant) | **Blocked:** live adapter not implemented (no UAT credentials); live payments must stay off until SDK + AI report can deliver the study | `/checkout`, `/payment/status`, `services/payments.ts`, `integrations/pinelabs.ts` |
| Payment status from server only | `GET /api/payments/orders/:id` (owner-only); page polls, handles pending/failed/cancelled/verification error/UAT label | integration ✓, e2e (not found) ✓ | Verified-success screen not exercised against a real provider | `/payment/status` |
| Paid entitlement only after verification, idempotent | `grantPaidAccess` requires `paid_verified` + verified payment; unique `orderId` | integration ✓ | — | `services/payments.ts` |
| Sandbox vs live separation | `orders.environment` uat/live; admin + events report separately | integration ✓ | — | — |
| Invitation codes (judges/pilots) | HMAC-stored, expiry, max uses, disable, per-code credits & tester cap, atomic redemption, audit, rate limit | integration ✓ (incl. concurrency) ; e2e ✓ | — | `/redeem`, `POST /api/access/redeem`, `/app/admin`, `npm run admin:codes` |
| Entitlement = study credits | Grants hold `studyCredits`/`creditsUsed`/participant cap; credit consumed atomically at first launch, row-locked; pause/resume/new version don't re-consume | integration ✓ (incl. concurrent launches) | — | `services/entitlements.ts`, `services/studies.ts` |
| No access without payment/code | Server: workspace routes 403 `no_entitlement`; client: `/app` → `/access` | integration ✓, e2e ✓ | — | `routes/projects.ts`, `routes/studies.ts`, `lib/auth.tsx` |
| Used-up credits keep prior work | Read access retained; new launch blocked with clear message | integration ✓ | — | — |
| Existing customers / migration | No database or users existed (never deployed), so the free-pilot grant was removed outright and the initial migration includes the new model. Nothing destroyed | — | If a deployment had existed, a data migration converting grants to credits would be needed | `prisma/migrations/20261024000000_init` |
| Conversion events (13 names) | Client allowlist (4 names) via `POST /api/events`; payment/redemption/activation/project/launch events recorded server-side only; random first-party visitor ID; UTM capture; environment tagged | integration ✓ | — | `services/conversions.ts`, `lib/track.ts`, admin overview |
| Admin metrics (leads, accounts, purchases live/UAT, redemptions, activations, launches) | Done | manual ✓ | — | `/app/admin`, `GET /api/admin/overview` |
| Privacy / Terms pages | Plain-language drafts, **clearly marked "Draft — pending legal review"** | — | **Needs human legal review before live payments** | `/privacy`, `/terms` |
| SEO / OG / favicon | Title, description, Open Graph, theme color, favicon | e2e (title) ✓ | No OG image yet | `apps/web/index.html` |
| Responsive (desktop, tablet, mobile) | Done; mobile hero note moved below card to avoid covering text | e2e mobile (no horizontal overflow on 7 pages) ✓, screenshots | — | — |
| Accessibility | Semantic headings, labeled inputs, keyboard FAQ (`<details>`), focus rings, reduced motion, AA contrast (all small text ≥ 4.5:1 after fixes) | e2e keyboard FAQ ✓; contrast computed | No screen-reader audit with real AT | — |
| Performance | Self-hosted Inter (CSP-safe), no third-party scripts; JS 130 KB gzip | — | Single bundle (no route splitting) | — |
| SDK boundary | Untouched: no SDK code; contracts unchanged | contract tests ✓ | — | `packages/sdk-contract` |
| Render deployment | `render.yaml` updated (`PAYMENTS_ENABLED=false`) | — | **Awaiting your approval** + a Git repo Render can read | `render.yaml` |

## Test results (actual runs)

| Suite | Command | Result |
|---|---|---|
| Unit | `npx vitest run --project unit` | 34 passed |
| Integration + SDK contract (real PostgreSQL) | `npx vitest run --project integration` | 49 passed |
| Browser (Playwright, headless Chrome, production build) | `PW_CHANNEL=chrome npx playwright test` | 9 passed (8 desktop, 1 mobile) |
| Typecheck | `tsc -p apps/server`, `tsc -p apps/web` | clean |

Defects found and fixed during QA: in-batch duplicate events double-counted; custom events didn't register their page in discovery; logout left a stale signed-in state (page bounced back into the workspace); page title and scroll position carried across routes; hero note covered text on mobile; seven small-text colors below AA contrast.

## Operational status of integrations

| Integration | Operational? |
|---|---|
| Standalone SDK | **No** — separate project, not connected |
| PostHog | **No** — not configured |
| AgenticOrg | **No** — not configured; landing promise of "one AI research report" can't be fulfilled yet |
| Pine Labs live checkout | **No** — not implemented/configured; checkout correctly shows unavailable |
