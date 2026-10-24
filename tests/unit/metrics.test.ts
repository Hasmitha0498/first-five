import { describe, expect, it } from "vitest";
import { computeStudyMetrics, median, reconcile, type MetricSessionInput } from "../../apps/server/src/services/metrics";

const t0 = new Date("2026-10-24T09:00:00Z");
const s = (status: MetricSessionInput["status"], extra: Partial<MetricSessionInput> = {}): MetricSessionInput => ({
  inviteId: Math.random().toString(36),
  status,
  isRepeat: false,
  startedAt: t0,
  goalVerifiedAt: status === "completed" ? new Date(t0.getTime() + 60_000) : null,
  answeredResponses: 0,
  ...extra,
});

describe("computeStudyMetrics", () => {
  it("returns null rates (never NaN) when nothing has finalized", () => {
    const m = computeStudyMetrics([]);
    expect(m.completionRate).toEqual({ numerator: 0, denominator: 0, percent: null });
    expect(m.dropRate.percent).toBeNull();
    expect(m.feedbackCoverage.percent).toBeNull();
    expect(m.medianCompletionMs).toBeNull();
    const pendingOnly = computeStudyMetrics([s("pending"), s("pending")]);
    expect(pendingOnly.attempts).toBe(2);
    expect(pendingOnly.completionRate.percent).toBeNull();
  });

  it("uses completed + dropped as the denominator and excludes invalid and repeats (A16)", () => {
    const sessions = [
      s("completed", { answeredResponses: 2 }),
      s("completed"),
      s("dropped", { answeredResponses: 1 }),
      s("dropped"),
      s("dropped"),
      s("pending"),
      s("invalid"),
      s("completed", { isRepeat: true }),
    ];
    const m = computeStudyMetrics(sessions);
    expect(m.completed).toBe(2);
    expect(m.dropped).toBe(3);
    expect(m.pending).toBe(1);
    expect(m.invalid).toBe(1);
    expect(m.repeatsExcluded).toBe(1);
    expect(m.attempts).toBe(6);
    expect(m.finalized).toBe(5);
    expect(m.completionRate).toEqual({ numerator: 2, denominator: 5, percent: 40 });
    expect(m.dropRate).toEqual({ numerator: 3, denominator: 5, percent: 60 });
    expect(m.feedbackCoverage).toEqual({ numerator: 2, denominator: 5, percent: 40 });
    expect(reconcile(m)).toEqual([]);
  });

  it("distinguishes people from attempts", () => {
    const m = computeStudyMetrics([s("completed", { inviteId: "a" }), s("dropped", { inviteId: "a" }), s("completed", { inviteId: "b" })]);
    expect(m.attempts).toBe(3);
    expect(m.uniqueParticipants).toBe(2);
  });

  it("computes the median time to goal over completed attempts only", () => {
    const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
    const m = computeStudyMetrics([
      s("completed", { goalVerifiedAt: at(30) }),
      s("completed", { goalVerifiedAt: at(90) }),
      s("completed", { goalVerifiedAt: at(60) }),
      s("dropped"),
    ]);
    expect(m.medianCompletionMs).toBe(60_000);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBeNull();
  });
});
