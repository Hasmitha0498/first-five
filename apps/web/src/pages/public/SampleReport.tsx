import type { StudyMetrics } from "@firstfive/shared";
import { Link } from "react-router-dom";
import { ReportDocument, type ViewFinding } from "../../components/ReportView";
import { Alert, buttonClass } from "../../components/ui";

// Illustrative data only. Not real research results, customers or AI output.
const METRICS: StudyMetrics = {
  attempts: 5,
  uniqueParticipants: 5,
  completed: 3,
  dropped: 2,
  pending: 0,
  invalid: 0,
  repeatsExcluded: 0,
  finalized: 5,
  completionRate: { numerator: 3, denominator: 5, percent: 60 },
  dropRate: { numerator: 2, denominator: 5, percent: 40 },
  medianCompletionMs: 128_000,
  feedbackCoverage: { numerator: 4, denominator: 5, percent: 80 },
};

const FINDINGS: ViewFinding[] = [
  {
    title: "Pricing was checked before signup",
    observed: "3 of 5 participants opened /pricing before starting signup. 2 of those 3 did not reach the dashboard within the time limit.",
    quotes: [{ text: "I wanted to know what it costs before giving my email.", who: "Participant 2" }],
    interpretation: "Uncertainty about cost may be delaying the decision to sign up. This is a hypothesis from a small sample.",
    evidenceStrength: "limited",
    suggestion: "Show a one-line summary of plan terms directly beside the “Create account” button.",
    retestMetric: "Completed attempts, and how many participants detour to /pricing first",
    affectedCount: 3,
    counterCount: 1,
  },
  {
    title: "The workspace name step caused repeated clicks",
    observed: "2 participants clicked “Continue” on /onboarding/workspace more than once before the page moved on.",
    quotes: [{ text: "I wasn't sure if it had saved — nothing seemed to happen.", who: "Participant 4" }],
    interpretation: "The button may not give enough feedback while it is working.",
    evidenceStrength: "inconclusive",
    suggestion: "Show a loading state on “Continue” and disable it while the workspace is being created.",
    retestMetric: "Repeated clicks on the Continue button",
    affectedCount: 2,
    counterCount: 0,
  },
];

export function SampleReportPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <ReportDocument
        banner={
          <Alert tone="warning" title="Example report — illustrative data">
            This page shows what a First Five report looks like. The website, participants, numbers and quotes are made up for demonstration.
          </Alert>
        }
        title="Onboarding test — findings"
        studyName="Example: Acme Notes (fictional)"
        task="Create an account and reach the dashboard."
        goalType="page_reached"
        goalTarget="/dashboard"
        metrics={METRICS}
        meta="5 participants · 5-minute time limit"
        summary="Most participants could create an account, but several looked for pricing first and one step gave unclear feedback. Both are worth testing with small changes."
        findings={FINDINGS}
      />
      <div className="mt-10 flex flex-wrap gap-3">
        <Link to="/signup" className={buttonClass("primary", "lg")}>
          Start testing
        </Link>
        <Link to="/" className={buttonClass("secondary", "lg")}>
          Back to homepage
        </Link>
      </div>
    </div>
  );
}
