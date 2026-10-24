import type { StudySummary } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { StudyBadge } from "../../components/status";
import { Card, EmptyState, ErrorState, LinkButton, PageHeader, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";

export function TestsPage() {
  const q = useQuery({ queryKey: ["studies"], queryFn: () => api<{ studies: StudySummary[] }>("/api/studies") });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const studies = q.data!.studies;
  return (
    <>
      <PageHeader
        title="Tests"
        description="Each test asks participants to complete one task on your website."
        action={studies.length > 0 && <LinkButton to="/app/tests/new" icon={Plus}>Set up a test</LinkButton>}
      />
      {studies.length === 0 ? (
        <Card>
          <EmptyState
            icon={FlaskConical}
            title="What would you like to test first?"
            description="Pick one important journey — like signing up, onboarding or checkout."
            action={<LinkButton to="/app/tests/new" icon={Plus}>Set up a test</LinkButton>}
          />
        </Card>
      ) : (
        <Card>
          <div className="hidden grid-cols-[1.5fr_1fr_8rem_8rem] gap-4 border-b border-line px-6 py-3 text-xs font-medium uppercase tracking-wide text-ink-muted md:grid">
            <span>Test</span>
            <span>Website</span>
            <span>Participants</span>
            <span>Status</span>
          </div>
          <ul className="divide-y divide-line">
            {studies.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/app/tests/${s.id}`}
                  className="grid gap-2 px-5 py-4 hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none md:grid-cols-[1.5fr_1fr_8rem_8rem] md:items-center md:gap-4 md:px-6"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="text-xs text-ink-muted">Created {formatDate(s.createdAt)}</span>
                  </span>
                  <span className="truncate text-sm text-ink-soft">{s.projectName}</span>
                  <span className="text-sm tabular-nums">
                    {s.participantCount} of {s.participantLimit}
                  </span>
                  <span>
                    <StudyBadge status={s.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
