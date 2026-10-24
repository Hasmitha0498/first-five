import { GOAL_TYPE_SHORT, type StudyDetail } from "@firstfive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Pencil, Play, Rocket, Square } from "lucide-react";
import { Link, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { StudyBadge } from "../../components/status";
import { Alert, Button, CopyButton, ErrorState, LinkButton, Spinner, Tabs } from "../../components/ui";
import { api, errorMessage, post } from "../../lib/api";
import { formatMinutes, hostOf } from "../../lib/format";

export function useStudy() {
  return useOutletContext<{ study: StudyDetail; refetch: () => void }>();
}

export function TestLayout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["study", id], queryFn: () => api<StudyDetail>(`/api/studies/${id}`) });
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["study", id] });
    qc.invalidateQueries({ queryKey: ["dashboard", id] });
    qc.invalidateQueries({ queryKey: ["studies"] });
  };
  const lifecycle = useMutation({
    mutationFn: (action: "launch" | "pause" | "resume" | "close") => post<StudyDetail>(`/api/studies/${id}/${action}`),
    onSuccess: (s, action) => {
      qc.setQueryData(["study", id], s);
      refreshAll();
      if (action === "launch") navigate(`/app/tests/${id}/ready`);
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const v = s.currentVersion;
  const editable = !["closed", "expired"].includes(s.status);

  return (
    <>
      <div className="mb-6">
        <Link to="/app/tests" className="text-sm text-ink-muted hover:text-ink">
          ← Tests
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{s.name}</h1>
              <StudyBadge status={s.status} />
              {s.versions.length > 1 && <span className="text-sm text-ink-muted">Version {v.version}</span>}
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-ink-muted">Website</dt>
                <dd className="font-medium">{s.projectName}</dd>
                <dd className="text-ink-muted">({hostOf(s.websiteUrl)})</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-muted">Goal</dt>
                <dd className="font-medium">
                  {GOAL_TYPE_SHORT[v.goalType]}: <span className="font-mono text-[13px]">{v.goalTarget}</span>
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-muted">Time limit</dt>
                <dd className="font-medium">{formatMinutes(v.timeLimitSeconds)}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && (
              <LinkButton to={`/app/tests/${s.id}/edit`} variant="secondary" icon={Pencil}>
                Edit
              </LinkButton>
            )}
            {(s.status === "active" || s.status === "full") && (
              <>
                <CopyButton text={s.shareUrl} label="Copy test link" copiedLabel="Link copied" variant="primary" size="md" />
                <Button variant="secondary" icon={Pause} loading={lifecycle.isPending && lifecycle.variables === "pause"} onClick={() => lifecycle.mutate("pause")}>
                  Pause
                </Button>
              </>
            )}
            {s.status === "paused" && (
              <Button icon={Play} loading={lifecycle.isPending && lifecycle.variables === "resume"} onClick={() => lifecycle.mutate("resume")}>
                Resume
              </Button>
            )}
            {(s.status === "draft" || s.status === "ready") && (
              <Button icon={Rocket} disabled={!s.readiness.canLaunch} loading={lifecycle.isPending && lifecycle.variables === "launch"} onClick={() => lifecycle.mutate("launch")} title={s.readiness.canLaunch ? undefined : "Resolve the items below before launching"}>
                Launch test
              </Button>
            )}
            {editable && s.status !== "draft" && s.status !== "ready" && (
              <Button
                variant="ghost"
                icon={Square}
                onClick={() => window.confirm("Close this test? Nobody else will be able to take it.") && lifecycle.mutate("close")}
              >
                Close
              </Button>
            )}
          </div>
        </div>
        {lifecycle.error && (
          <Alert tone="danger" className="mt-4">
            {errorMessage(lifecycle.error)}
          </Alert>
        )}
      </div>
      <div className="mb-6">
        <Tabs
          tabs={[
            { to: `/app/tests/${s.id}`, label: "Overview", end: true },
            { to: `/app/tests/${s.id}/participants`, label: "Participants", count: s.participantCount },
            { to: `/app/tests/${s.id}/findings`, label: "Findings" },
          ]}
        />
      </div>
      <Outlet context={{ study: s, refetch: refreshAll }} />
    </>
  );
}
