import { describe, expect, it } from "vitest";
import { analyzeTimeline, computeFunnel, orderEvents, type StoredEvent } from "../../apps/server/src/services/timeline";

const t0 = new Date("2026-10-24T09:00:00Z");
let n = 0;
const ev = (seq: number | null, name: string, extra: Partial<StoredEvent> = {}): StoredEvent => ({
  id: `id${++n}`,
  eventId: `e${n}`,
  eventName: name,
  clientSequence: seq,
  clientTimestamp: new Date(t0.getTime() + (seq ?? 99) * 1000),
  receivedAt: new Date(t0.getTime() + 100_000),
  pagePath: null,
  elementKey: null,
  elementType: null,
  elementLabel: null,
  ...extra,
});

describe("timeline analysis", () => {
  it("orders out-of-order events by client sequence (A12)", () => {
    const events = [ev(3, "ff_page_viewed", { pagePath: "/c" }), ev(1, "ff_page_viewed", { pagePath: "/a" }), ev(2, "ff_page_viewed", { pagePath: "/b" })];
    expect(orderEvents(events).map((e) => e.pagePath)).toEqual(["/a", "/b", "/c"]);
  });

  it("counts backtracks (ignoring immediate duplicates) and repeated clicks", () => {
    const events = [
      ev(1, "ff_page_viewed", { pagePath: "/" }),
      ev(2, "ff_page_viewed", { pagePath: "/" }),
      ev(3, "ff_page_viewed", { pagePath: "/pricing" }),
      ev(4, "ff_page_viewed", { pagePath: "/" }),
      ev(5, "ff_element_clicked", { pagePath: "/", elementKey: "signup" }),
      ev(6, "ff_element_clicked", { pagePath: "/", elementKey: "signup" }),
      ev(7, "ff_activity"),
    ];
    const a = analyzeTimeline(events, { startedAt: t0, verifiedGoalEventId: null });
    expect(a.pagesVisited).toBe(2);
    expect(a.backtracks).toBe(1);
    expect(a.clickCount).toBe(2);
    expect(a.repeatedInteractions).toBe(1);
    expect(a.lastEvent?.name).toBe("ff_element_clicked");
    expect(a.timeline.find((t) => t.isBacktrack)?.pagePath).toBe("/");
  });

  it("marks the verified goal event", () => {
    const g = ev(1, "ff_page_viewed", { pagePath: "/dashboard" });
    const a = analyzeTimeline([g], { startedAt: t0, verifiedGoalEventId: g.eventId });
    expect(a.timeline[0]!.isGoal).toBe(true);
  });

  it("computes a monotonic funnel from configured milestones only", () => {
    const m = [
      { label: "Signup", type: "page_reached" as const, target: "/signup" },
      { label: "Dashboard", type: "page_reached" as const, target: "/dashboard" },
    ];
    const s1 = [ev(1, "ff_page_viewed", { pagePath: "/signup" }), ev(2, "ff_page_viewed", { pagePath: "/dashboard" })];
    const s2 = [ev(1, "ff_page_viewed", { pagePath: "/dashboard" }), ev(2, "ff_page_viewed", { pagePath: "/signup" })];
    const s3 = [ev(1, "ff_page_viewed", { pagePath: "/" })];
    expect(computeFunnel([s1, s2, s3], m)).toEqual([
      { label: "Signup", reached: 2, previous: 3 },
      { label: "Dashboard", reached: 1, previous: 2 },
    ]);
  });
});
