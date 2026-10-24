import { GOAL_TYPE_SHORT, type StudyDetail } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { StudyBadge } from "../../components/status";
import { Card, CopyButton, ErrorState, KeyValue, LinkButton, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

export function TestReadyPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["study", id], queryFn: () => api<StudyDetail>(`/api/studies/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} />;
  const s = q.data!;
  const live = s.status === "active" || s.status === "full";
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="p-6 sm:p-8">
        <CheckCircle2 className="h-10 w-10 text-success" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{live ? "Your test is ready." : "This test isn't live right now."}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          Share this link with people who haven't used this flow before. We'll track how they attempt the task and ask for feedback at the end.
        </p>
        <div className="mt-6 rounded-lg border border-line bg-canvas p-3">
          <div className="break-all font-mono text-sm">{s.shareUrl}</div>
        </div>
        <div className="mt-4">
          <CopyButton text={s.shareUrl} label="Copy test link" copiedLabel="Link copied" variant="primary" size="lg" />
        </div>
        <div className="mt-8 border-t border-line pt-6">
          <KeyValue
            items={[
              { label: "Test", value: s.name },
              { label: "Status", value: <StudyBadge status={s.status} /> },
              { label: "Task", value: s.currentVersion.task },
              { label: "Goal", value: `${GOAL_TYPE_SHORT[s.currentVersion.goalType]}: ${s.currentVersion.goalTarget}` },
              { label: "Participant limit", value: s.participantLimit },
              { label: "Participants so far", value: s.participantCount },
            ]}
          />
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          <LinkButton to={`/app/tests/${s.id}`} variant="secondary">
            Go to test overview
          </LinkButton>
          <Link to={`/t/${s.publicId}`} target="_blank" className="inline-flex h-10 items-center px-2 text-sm font-medium text-accent hover:underline">
            Preview what participants see
          </Link>
        </div>
      </Card>
    </div>
  );
}
