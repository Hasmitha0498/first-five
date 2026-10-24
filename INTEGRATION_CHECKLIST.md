# Integration Checklist

Nothing below is marked ready because of scaffolding alone. "Verified" requires a real end-to-end check recorded with a date.

| Integration | Current status | What exists in this repo | What's needed to connect | Verify by |
|---|---|---|---|---|
| **First Five SDK** (separate project) | **Pending connection** — separately developed, never tested against this backend | Snippet generation (`SDK_SCRIPT_URL`, preview label when unset), full SDK API (config, exchange, session, events, end, setup finish), origin allowlists, discovery catalog, session engine, contract docs + OpenAPI, contract tests with fixtures | Hosted SDK URL → set `SDK_SCRIPT_URL`; SDK built against [SDK_INTEGRATION.md](docs/integrations/SDK_INTEGRATION.md) | §12 of the SDK guide: real setup walk turns website **Connected**; real participant completes; feedback loads |
| **PostHog Cloud** | **Pending configuration** (Not configured) | Adapter: event mapping, `/batch/` capture, HogQL query, round-trip verification, durable outbox with retries | `POSTHOG_HOST`, `POSTHOG_PROJECT_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` | `/app/admin` → Run verification → **Verified** (event captured and read back) — [guide](docs/integrations/POSTHOG_SETUP.md) |
| **AgenticOrg UX Director** | **Pending configuration** (Not configured; live connector intentionally not implemented) | Typed interface, evidence package type, output validator, `agent_runs`, report states, external-approval publish gate, fallback interview question | Real workspace: stored agent, workflow with HITL stage, trigger mechanism, credentials | Authentic run ID recorded, approval in AgenticOrg, publish audited — [guide](docs/integrations/AGENTICORG_SETUP.md) |
| **Pine Labs** | **Pending configuration** (Not configured; API calls intentionally not implemented). Checkout additionally gated by `PAYMENTS_ENABLED=false` | Orders/payments/webhook tables, ₹99 single-study offer, order-status endpoint + `/payment/status` page, idempotent webhook handling, amount check, credit-granted-only-after-verification rule, UAT/live flag | UAT credentials, current API reference, webhook registration | Legitimate UAT transaction → `paid_verified` order + one paid grant — [guide](docs/integrations/PINELABS_SETUP.md) |
| **Render PostgreSQL** | **Local: verified** — migrations applied and 49 integration/contract tests pass against embedded PostgreSQL 17. **Render: not provisioned** (awaiting your approval to deploy) | Prisma schema, migrations, `render.yaml` (free plan, internal-only) | Deploy the Blueprint | `GET /readyz` → `{"database":"ok"}` on the Render URL; `/app/admin` → Postgres → Run verification |
| **Render web service** | **Not deployed** | `render.yaml`, build/start scripts, `/healthz`, `/readyz`, graceful shutdown | Your approval + a Git repository Render can read | `bash scripts/smoke.sh https://<service>.onrender.com` |

## Connection log

| Date | Integration | Result | Evidence |
|---|---|---|---|
| — | — | Nothing connected yet | — |
