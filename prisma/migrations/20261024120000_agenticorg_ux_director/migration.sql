-- UX Director (AgenticOrg) integration: audit copy of validated output,
-- per-finding improvement prompt, and raw run facts.
ALTER TABLE "reports" ADD COLUMN "agentOutput" JSONB;
ALTER TABLE "report_findings" ADD COLUMN "improvementPrompt" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN "details" JSONB;
