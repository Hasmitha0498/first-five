import type { ReportSummary } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import { NotebookText } from "lucide-react";
import { Link } from "react-router-dom";
import { ReportBadge } from "../../components/status";
import { Card, EmptyState, ErrorState, LinkButton, PageHeader, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { timeAgo } from "../../lib/format";

export function ReportsPage() {
  const q = useQuery({ queryKey: ["reports"], queryFn: () => api<{ reports: ReportSummary[] }>("/api/reports") });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const reports = q.data!.reports;
  return (
    <>
      <PageHeader title="Reports" description="Findings you've drafted, reviewed and published." />
      {reports.length === 0 ? (
        <Card>
          <EmptyState
            icon={NotebookText}
            title="No reports yet"
            description="Open a test's Findings tab to start a report once participants have taken it."
            action={<LinkButton to="/app/tests" variant="secondary">Go to tests</LinkButton>}
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {reports.map((r) => (
              <li key={r.id}>
                <Link to={`/app/reports/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none sm:px-6">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.title}</div>
                    <div className="mt-0.5 text-sm text-ink-muted">
                      {r.studyName} · {r.findingCount} finding{r.findingCount === 1 ? "" : "s"} · Updated {timeAgo(r.updatedAt)}
                    </div>
                  </div>
                  <ReportBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
