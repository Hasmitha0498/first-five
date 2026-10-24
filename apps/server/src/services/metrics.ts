/**
 * Deterministic study metrics. No AI model is involved in any count or rate.
 *
 *   Valid started attempts = completed + dropped + pending   (excludes invalid and repeats)
 *   Finalized              = completed + dropped
 *   Completion rate        = completed / finalized            (null when finalized = 0)
 *   Drop rate              = dropped / finalized              (null when finalized = 0)
 *   Median completion time = median(goalVerifiedAt − startedAt) over completed
 *   Feedback coverage      = finalized attempts with ≥1 answered response / finalized attempts
 */
import type { RateValue, StudyMetrics } from "@firstfive/shared";
import { percent } from "@firstfive/shared";

export interface MetricSessionInput {
  inviteId: string;
  status: "pending" | "completed" | "dropped" | "invalid";
  isRepeat: boolean;
  startedAt: Date;
  goalVerifiedAt: Date | null;
  answeredResponses: number;
}

export function rate(numerator: number, denominator: number): RateValue {
  return { numerator, denominator, percent: percent(numerator, denominator) };
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

export function computeStudyMetrics(sessions: MetricSessionInput[]): StudyMetrics {
  const primary = sessions.filter((s) => !s.isRepeat);
  const valid = primary.filter((s) => s.status !== "invalid");
  const completed = valid.filter((s) => s.status === "completed");
  const dropped = valid.filter((s) => s.status === "dropped");
  const pending = valid.filter((s) => s.status === "pending");
  const finalized = [...completed, ...dropped];
  const withFeedback = finalized.filter((s) => s.answeredResponses > 0);
  const completionTimes = completed
    .filter((s) => s.goalVerifiedAt)
    .map((s) => s.goalVerifiedAt!.getTime() - s.startedAt.getTime())
    .filter((ms) => ms >= 0);

  return {
    attempts: valid.length,
    uniqueParticipants: new Set(valid.map((s) => s.inviteId)).size,
    completed: completed.length,
    dropped: dropped.length,
    pending: pending.length,
    invalid: primary.length - valid.length,
    repeatsExcluded: sessions.length - primary.length,
    finalized: finalized.length,
    completionRate: rate(completed.length, finalized.length),
    dropRate: rate(dropped.length, finalized.length),
    medianCompletionMs: median(completionTimes),
    feedbackCoverage: rate(withFeedback.length, finalized.length),
  };
}

/** Invariants from PRD §14.4 — used by tests and available for runtime assertions. */
export function reconcile(m: StudyMetrics): string[] {
  const problems: string[] = [];
  if (m.attempts !== m.completed + m.dropped + m.pending) problems.push("valid_started != completed + dropped + pending");
  if (m.finalized !== m.completed + m.dropped) problems.push("finalized != completed + dropped");
  if (m.completionRate.denominator !== m.finalized || m.dropRate.denominator !== m.finalized) problems.push("rate denominators");
  return problems;
}
