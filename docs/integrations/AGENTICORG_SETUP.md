# AgenticOrg UX Director — Setup Guide

**Status:** live connector implemented ([`apps/server/src/integrations/agenticorg.ts`](../../apps/server/src/integrations/agenticorg.ts)) and verified end to end against the hackathon workspace on 24 Oct 2026 (`scripts/agenticorg-live-check.ts`). Publishing an AgenticOrg report additionally needs `AGENTICORG_APPROVALS_API_KEY` (see §2).

## 1. What it does
1. **Contextual interview question (Q2).** When a participant opens the feedback page, Render sends the attempt's sanitized events to the `ff_q2_generator` agent and shows its single neutral question. If the agent is slow (`AGENTICORG_Q2_TIMEOUT_MS`, default 8 s), fails or returns nothing usable, the standard fallback "Was anything different from what you expected?" is shown. Every attempt is recorded in `agent_runs` (`kind = contextual_question`).
2. **Research report.** **Findings → Run analysis** builds the evidence package (study definition, intended path, backend-computed metrics, finished non-repeat attempts with ordered events and the participants' own answers; pseudonymous IDs only) and runs the `ff_ux_director` agent in the background (~20–30 s).
3. **Validation.** The output is rejected (`report.status = failed`, nothing stored) if it cites unknown sessions/events/responses, gives counts that disagree with the backend, uses non-verbatim quotes, puts a session on both sides of a finding, or uses percentages. Counts are always filled in by Render.
4. **Human approval in AgenticOrg.** Every report run queues an AgenticOrg HITL approval (the agent's HITL condition is always true). The draft waits in `awaiting_review`; it can't be approved inside First Five.
5. **Approval sync and publish.** The maintenance sweep matches the approval to the run by `correlation_id`, records the decision (`report_approvals`, channel `agenticorg`, `externalApprovalId`), and moves the report to `approved` / `rejected`. Publishing re-confirms the approval with AgenticOrg.

## 2. What it needs
| Variable | Purpose |
|---|---|
| `AGENTICORG_BASE_URL` | `https://agenticorg.hackathon.pinelabs.com` (the AgenticOrg SDK default `app.agenticorg.ai` is wrong for this workspace) |
| `AGENTICORG_API_KEY` | Execution-scoped key (**secret**). Runs agents by ID only |
| `AGENTICORG_Q2_AGENT_ID` | `ff_q2_generator` — `0634d289-3ed1-46c4-9e19-5a6a7e126ecf` |
| `AGENTICORG_REPORT_AGENT_ID` | `ff_ux_director` — `71d58400-3e14-4933-b55c-e503684743b1` |
| `AGENTICORG_APPROVALS_API_KEY` | Key with `approvals:read` (admin-issued). **Without it, decisions can't be read and AgenticOrg reports can't be published.** |
| `AGENTICORG_Q2_TIMEOUT_MS` / `AGENTICORG_REPORT_TIMEOUT_MS` | 8000 / 150000 |

## 3. Run contract (verified live)
`POST {BASE}/api/v1/agents/{agent_id}/run`, `Authorization: Bearer <key>`, `Content-Type: application/json`, body `{"action":"process","inputs":{"query":"…","payload":{…}},"context":{…}}`.
- Response: `run_id`, `correlation_id`, `status` (`completed` | `hitl_triggered` | `failed`), `output`, `confidence`.
- `output` is either the agent's JSON as an object, or `{raw_output}` holding a Python-repr content block `{'type': 'text', 'text': '<json>'}`. Both are handled (`parseAgentOutput`).
- A non-JSON body returns 422. The tenant's shared LLM rate limit returns 429; the adapter retries with backoff.

## 4. Where to configure it
Render → **first-five → Environment**. Never in Git or chat.

## 5. How to test
- **/app/admin → Integrations → AgenticOrg → Run verification** makes one real Q2 run on a synthetic attempt (no participant data) and reports whether approvals are readable.
- Local end to end: `AGENTICORG_* npx tsx scripts/agenticorg-live-check.ts` (throwaway Postgres, five synthetic participants, live Q2 and report runs).

## 6. Known platform behavior (24 Oct 2026)
- Every HITL condition evaluates as true on the tenant, so Q2 runs also queue approvals. They are ignorable; Q2 output is used regardless and the items expire after 4 h.
- After an agent's first run, changing its HITL condition or confidence floor needs an owner-approved governance change in AgenticOrg. Model changes apply immediately. The confidence floor can't go below 0.5.
- `gpt-6.1-sol` fails on the tenant; the agents use `gpt-5.6-luna` (Q2) and `gpt-5.6-sol` (report).

## 7. Troubleshooting
Inspect `agent_runs.error`/`details`, `reports.failure_reason`, Render logs and the AgenticOrg run history. Never "fix" a failed run by inserting findings under the `agenticorg` source.

## 8. How to disconnect
Remove the variables and redeploy. Interviews fall back to the standard Q2; **Run analysis** returns "AI findings aren't available yet."; owner-written reports keep working.
