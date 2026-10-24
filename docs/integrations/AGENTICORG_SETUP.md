# AgenticOrg UX Director — Setup Guide

**Status:** typed interface only ([`apps/server/src/integrations/agenticorg.ts`](../../apps/server/src/integrations/agenticorg.ts)). **No live connector exists yet**, by design: AgenticOrg's actual trigger, API, connector and approval capabilities must be inspected in the real workspace first. No agent run, question, finding or approval is ever simulated.

## 1. What it does
The UX Director has five responsibilities:
1. Generate one neutral contextual interview question from a single attempt's sanitized summary (Q2). Fallback: “Was anything different from what you expected?”
2. Analyze individual attempts (observed / reported / hypothesized).
3. Compare behavior across attempts.
4. Recommend evidence-backed, testable improvements.
5. Publish a report only after a human approves it in AgenticOrg's HITL step.

Render already provides: evidence packaging (`EvidencePackage`), structured-output validation that rejects unknown sessions/events/responses and counts that differ from the backend ([`research-output.ts`](../../apps/server/src/services/research-output.ts)), `agent_runs`, report states (`processing → draft → awaiting_review → approved → published`), and a publish gate that requires an approval for the **current report revision** on the `agenticorg` channel, confirmed through `getApproval()`.

## 2. What it needs
| Variable | Purpose |
|---|---|
| `AGENTICORG_BASE_URL` | Workspace API base URL (from AgenticOrg) |
| `AGENTICORG_API_KEY` | Least-privilege credential (**secret**) |
| `AGENTICORG_WORKFLOW_ID` | Versioned “First Five UX Director” workflow |
| `AGENTICORG_WEBHOOK_SECRET` | If AgenticOrg calls back into Render |

Plus: who is authorized to approve in AgenticOrg's HITL system.

## 3. Where to get it
In the hackathon AgenticOrg workspace: create the stored agent + workflow with a human-approval stage; check the workspace docs (agenticorg.ai/docs/workflows, /approvals) for how workflows are triggered (API, MCP, connector) and how tool calls reach external services.

## 4. Where to configure it
Render → **first-five → Environment**. Never in Git or chat.

## 5. How to test
After implementation: **/app/admin → Integrations → AgenticOrg → Run verification** must perform a real call. Then on a study with real participant data: **Findings → Run analysis**; confirm an `agent_runs` row with the provider's real run ID; approve in AgenticOrg; publish; check `audit_logs` for `report.published` with the approval reference.

## 6. Expected success
Verified status; a report with `source = agenticorg`; approval recorded with `externalApprovalId`; a published share link.

## 7. Common errors
`503 provider_not_configured` (expected today); schema-validation failures (agent cited unknown evidence — the run is recorded as failed and nothing is stored); `external_approval_required` when trying to approve an AgenticOrg report locally (by design).

## 8. Troubleshooting
Inspect `agent_runs.error`, Render logs, and the AgenticOrg run history. Never “fix” a failed run by inserting findings manually under the `agenticorg` source.

## 9. How to disconnect
Remove the variables and redeploy. Interviews fall back to the standard Q2; Findings shows “AI findings aren't available yet.”; owner-written reports keep working.

## 10. Re-run regression tests
`npm test` — the provider tests assert nothing is fabricated when unconfigured.

**Claude Code prompt:** “Connect AgenticOrg” — inspect the real workspace capabilities first, then implement `AgenticOrgAdapter` (set `implemented = true` only after a verified run), verify an authentic analysis run and an approved publication.
