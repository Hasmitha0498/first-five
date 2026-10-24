import { FINAL_REASON_LABELS, type SessionListItem, type SessionStatus, describeCustomEvent, type EventDetails } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { FeedbackBadge, SessionBadge } from "../../components/status";
import { Card, EmptyState, ErrorState, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDuration, timeAgo } from "../../lib/format";
import { useStudy } from "./TestLayout";

const FILTERS: { key: SessionStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "dropped", label: "Didn't complete" },
  { key: "pending", label: "Still in progress" },
  { key: "invalid", label: "Excluded" },
];

export function TestParticipantsPage() {
  const { study } = useStudy();
  const [filter, setFilter] = useState<SessionStatus | "all">("all");
  const q = useQuery({
    queryKey: ["sessions", study.id],
    queryFn: () => api<{ sessions: SessionListItem[] }>(`/api/studies/${study.id}/sessions`),
    refetchInterval: study.status === "active" ? 15_000 : false,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const all = q.data!.sessions;
  if (all.length === 0) {
    return (
      <Card>
        <EmptyState icon={Users} title="No one has taken this test yet." description="Share the link to get started." />
      </Card>
    );
  }
  const rows = filter === "all" ? all : all.filter((s) => s.status === filter);
  const count = (k: SessionStatus | "all") => (k === "all" ? all.length : all.filter((s) => s.status === k).length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter attempts">
        {FILTERS.filter((f) => f.key === "all" || count(f.key) > 0).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={clsx(
              "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              filter === f.key ? "border-accent bg-accent-soft font-medium text-accent-ink" : "border-line bg-surface text-ink-soft hover:bg-canvas",
            )}
          >
            {f.label} <span className="text-ink-muted">{count(f.key)}</span>
          </button>
        ))}
      </div>
      {filter === "pending" && <p className="text-sm text-ink-muted">Some participants are still completing their tasks.</p>}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Participant</th>
                <th scope="col" className="px-3 py-3 font-medium">Outcome</th>
                <th scope="col" className="px-3 py-3 font-medium">Time</th>
                <th scope="col" className="px-3 py-3 font-medium">Clicks</th>
                <th scope="col" className="px-3 py-3 font-medium">Pages</th>
                <th scope="col" className="px-3 py-3 font-medium">Went back</th>
                <th scope="col" className="px-3 py-3 font-medium">{filter === "dropped" ? "Last thing we saw" : "Feedback"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-canvas">
                  <td className="px-5 py-3">
                    <Link to={s.id} className="font-medium text-ink hover:text-accent hover:underline">
                      {s.participantLabel}
                    </Link>
                    <div className="text-xs text-ink-muted">Started {timeAgo(s.startedAt)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <SessionBadge status={s.status} />
                    {s.finalReason && s.status !== "completed" && <div className="mt-1 text-xs text-ink-muted">{FINAL_REASON_LABELS[s.finalReason] ?? s.finalReason}</div>}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{formatDuration(s.timeToGoalMs ?? s.durationMs)}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {s.clickCount}
                    {s.repeatedInteractions > 0 && <span className="ml-1 text-xs text-warning">({s.repeatedInteractions} repeated)</span>}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{s.pagesVisited}</td>
                  <td className="px-3 py-3 tabular-nums">{s.backtracks}</td>
                  <td className="px-3 py-3">
                    {filter === "dropped" ? (
                      <span className="text-xs text-ink-soft">{s.lastEvent ? describeEvent(s.lastEvent) : "No activity received"}</span>
                    ) : (
                      <FeedbackBadge status={s.feedbackStatus} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function describeEvent(e: {
  name: string;
  pagePath: string | null;
  label: string | null;
  customName?: string | null;
  details?: EventDetails | null;
}) {
  switch (e.name) {
    case "ff_page_viewed":
      return `Viewed ${e.pagePath}`;
    case "ff_element_clicked":
      return `Clicked “${e.label ?? "an element"}”${e.pagePath ? ` on ${e.pagePath}` : ""}`;
    case "ff_form_submitted":
      return `Submitted a form${e.pagePath ? ` on ${e.pagePath}` : ""}`;
    case "ff_custom_event":
      return describeCustomEvent(e.customName, e.details, e.pagePath);
    case "ff_client_error":
      return `Page error${e.pagePath ? ` on ${e.pagePath}` : ""}`;
    case "ff_goal_reached":
      return "Website reported reaching the goal";
    case "ff_activity":
      return "Active on page";
    default:
      return e.name;
  }
}
