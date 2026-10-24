/**
 * Deterministic per-attempt behavior analysis from the stored, sanitized event
 * history. Describes what was observed; never infers causes.
 */
import type { TimelineEvent } from "@firstfive/shared";
import { pathsEqual } from "../lib/url";

export interface StoredEvent {
  id: string;
  eventId: string;
  eventName: string;
  clientSequence: number | null;
  clientTimestamp: Date;
  receivedAt: Date;
  pagePath: string | null;
  elementKey: string | null;
  elementType: string | null;
  elementLabel: string | null;
  properties?: unknown;
}

export interface TimelineAnalysis {
  timeline: TimelineEvent[];
  clickCount: number;
  pagesVisited: number;
  pagePaths: string[];
  backtracks: number;
  repeatedInteractions: number;
  clientErrors: number;
  lastEvent: { name: string; pagePath: string | null; label: string | null; at: string } | null;
}

/** Stable order: client sequence, then client timestamp, then receipt time. */
export function orderEvents<T extends StoredEvent>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const sa = a.clientSequence ?? Number.MAX_SAFE_INTEGER;
    const sb = b.clientSequence ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    const ta = a.clientTimestamp.getTime() - b.clientTimestamp.getTime();
    if (ta !== 0) return ta;
    return a.receivedAt.getTime() - b.receivedAt.getTime();
  });
}

const MEANINGFUL = new Set(["ff_page_viewed", "ff_element_clicked", "ff_form_submitted", "ff_custom_event", "ff_client_error"]);

export function analyzeTimeline(events: StoredEvent[], opts: { startedAt: Date; verifiedGoalEventId: string | null }): TimelineAnalysis {
  const ordered = orderEvents(events);
  const seenPages: string[] = [];
  const clickedElements = new Set<string>();
  let previousPage: string | null = null;
  let clickCount = 0;
  let backtracks = 0;
  let repeatedInteractions = 0;
  let clientErrors = 0;

  const timeline: TimelineEvent[] = ordered.map((e) => {
    let isBacktrack = false;
    let isRepeat = false;
    if (e.eventName === "ff_page_viewed" && e.pagePath) {
      const immediateDuplicate = pathsEqual(previousPage, e.pagePath);
      if (!immediateDuplicate) {
        if (seenPages.some((p) => pathsEqual(p, e.pagePath))) {
          isBacktrack = true;
          backtracks++;
        } else {
          seenPages.push(e.pagePath);
        }
      }
      previousPage = e.pagePath;
    }
    if (e.eventName === "ff_element_clicked") {
      clickCount++;
      const key = `${e.pagePath ?? ""}::${e.elementKey ?? e.elementLabel ?? ""}`;
      if (clickedElements.has(key)) {
        isRepeat = true;
        repeatedInteractions++;
      }
      clickedElements.add(key);
    }
    if (e.eventName === "ff_client_error") clientErrors++;
    return {
      id: e.id,
      eventId: e.eventId,
      name: e.eventName,
      at: e.clientTimestamp.toISOString(),
      offsetMs: Math.max(0, e.clientTimestamp.getTime() - opts.startedAt.getTime()),
      sequence: e.clientSequence,
      pagePath: e.pagePath,
      elementKey: e.elementKey,
      elementType: e.elementType,
      label: e.elementLabel,
      isGoal: opts.verifiedGoalEventId != null && e.eventId === opts.verifiedGoalEventId,
      isBacktrack,
      isRepeat,
    };
  });

  const last = [...ordered].reverse().find((e) => MEANINGFUL.has(e.eventName));
  return {
    timeline,
    clickCount,
    pagesVisited: seenPages.length,
    pagePaths: seenPages,
    backtracks,
    repeatedInteractions,
    clientErrors,
    lastEvent: last
      ? { name: last.eventName, pagePath: last.pagePath, label: last.elementLabel, at: last.clientTimestamp.toISOString() }
      : null,
  };
}

export interface MilestoneDef {
  label: string;
  type: "element_clicked" | "page_reached" | "custom_event";
  target: string;
}

export function eventMatches(e: Pick<StoredEvent, "eventName" | "pagePath" | "elementKey" | "properties">, m: MilestoneDef): boolean {
  if (m.type === "page_reached") return e.eventName === "ff_page_viewed" && pathsEqual(e.pagePath, m.target);
  if (m.type === "element_clicked") return e.eventName === "ff_element_clicked" && e.elementKey === m.target;
  const props = (e.properties ?? {}) as Record<string, unknown>;
  return e.eventName === "ff_custom_event" && props.custom_event_name === m.target;
}

/** Monotonic funnel: a milestone counts only if reached after the previous one. */
export function computeFunnel(sessionsEvents: StoredEvent[][], milestones: MilestoneDef[]) {
  const reached = milestones.map(() => 0);
  for (const events of sessionsEvents) {
    const ordered = orderEvents(events);
    let cursor = 0;
    for (let i = 0; i < milestones.length; i++) {
      const idx = ordered.slice(cursor).findIndex((e) => eventMatches(e, milestones[i]!));
      if (idx === -1) break;
      reached[i]!++;
      cursor += idx + 1;
    }
  }
  return milestones.map((m, i) => ({ label: m.label, reached: reached[i]!, previous: i === 0 ? sessionsEvents.length : reached[i - 1]! }));
}
