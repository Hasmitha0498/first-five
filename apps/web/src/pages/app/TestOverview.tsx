import type { DashboardResponse } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Share2, Sparkles, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Alert, Card, CardHeader, CopyButton, EmptyState, ErrorState, LinkButton, Pill, Spinner } from "../../components/ui";
import { ReportBadge } from "../../components/status";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime, formatDuration } from "../../lib/format";
import { useStudy } from "./TestLayout";

export function TestOverviewPage() {
  const { study } = useStudy();
  const q = useQuery({
    queryKey: ["dashboard", study.id],
    queryFn: () => api<DashboardResponse>(`/api/studies/${study.id}/dashboard`),
    refetchInterval: study.status === "active" ? 15_000 : false,
  });

  const notLaunched = study.status === "draft" || study.status === "ready";

  return (
    <div className="space-y-6">
      {notLaunched && <LaunchChecklist />}
      {(study.status === "active" || study.status === "full") && (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <Share2 className="h-5 w-5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0">
              <div className="text-sm font-medium">Test link</div>
              <div className="truncate font-mono text-[13px] text-ink-muted">{study.shareUrl}</div>
            </div>
          </div>
          <CopyButton text={study.shareUrl} label="Copy test link" copiedLabel="Link copied" variant="primary" size="md" />
        </Card>
      )}

      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && <Dashboard d={q.data} />}
    </div>
  );
}

function LaunchChecklist() {
  const { study } = useStudy();
  const r = study.readiness;
  const v = study.currentVersion;
  const items = [
    { ok: !r.blockers.some((b) => b.code === "integration_not_connected"), label: "Website connected", to: `/app/websites/${study.projectId}` },
    { ok: v.startVerified, label: `Start page ${v.startPath} seen on your website`, to: `/app/websites/${study.projectId}/journey` },
    { ok: v.goalVerified, label: "Success condition seen on your website", to: `/app/websites/${study.projectId}/journey` },
  ];
  return (
    <Card>
      <CardHeader title={r.canLaunch ? "Ready to launch" : "Before you launch"} description={r.canLaunch ? "Everything checks out. Launch the test to get a shareable link." : "Your test is saved as a draft. These steps make sure we can record what participants do."} />
      <ul className="space-y-3 p-5 sm:p-6">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-3 text-sm">
            {i.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-label="Not done" />}
            <span className="flex-1">{i.label}</span>
            {!i.ok && (
              <Link to={i.to} className="font-medium text-accent hover:underline">
                Fix
              </Link>
            )}
          </li>
        ))}
        {r.blockers
          .filter((b) => !["integration_not_connected", "start_unverified", "goal_unverified", "status"].includes(b.code))
          .map((b) => (
            <li key={b.code}>
              <Alert tone="warning">{b.message}</Alert>
            </li>
          ))}
      </ul>
    </Card>
  );
}

function Dashboard({ d }: { d: DashboardResponse }) {
  const m = d.metrics;
  const noParticipants = m.attempts === 0 && m.invalid === 0;
  return (
    <>
      <section aria-labelledby="succeed">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="succeed" className="text-lg font-semibold">
            Did people succeed?
          </h2>
          <span className="text-xs text-ink-muted">Updated {formatDateTime(d.dataUpdatedAt)}</span>
        </div>
        {noParticipants ? (
          <Card>
            <EmptyState icon={Users} title="No one has taken this test yet." description="Share the link to get started." />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="People tested" value={m.uniqueParticipants} sub={m.attempts !== m.uniqueParticipants ? `${m.attempts} attempts` : `${m.attempts} attempt${m.attempts === 1 ? "" : "s"}`} />
              <Tile label="Completed" value={m.completed} tone="success" sub={m.finalized ? `${m.completed} of ${m.finalized} finished` : undefined} />
              <Tile label="Didn't complete" value={m.dropped} tone="warning" sub={m.finalized ? `${m.dropped} of ${m.finalized} finished` : undefined} />
              <Tile label="Still in progress" value={m.pending} />
            </div>
            <Card className="mt-4 grid gap-6 p-5 sm:grid-cols-3 sm:p-6">
              <Rate label="Completion rate" value={m.completionRate.percent} detail={`${m.completionRate.numerator} of ${m.completionRate.denominator} finished attempts`} empty="Appears once an attempt finishes" />
              <Rate label="Median time to complete" text={m.medianCompletionMs != null ? formatDuration(m.medianCompletionMs) : null} detail={`Across ${m.completed} completed attempt${m.completed === 1 ? "" : "s"}`} empty="Appears after the first completion" />
              <Rate label="Feedback coverage" value={m.feedbackCoverage.percent} detail={`${m.feedbackCoverage.numerator} of ${m.feedbackCoverage.denominator} finished attempts answered`} empty="Appears once an attempt finishes" />
            </Card>
            {m.pending > 0 && <p className="mt-3 text-sm text-ink-muted">Some participants are still completing their tasks.</p>}
            {(m.invalid > 0 || m.repeatsExcluded > 0) && (
              <p className="mt-2 text-sm text-ink-muted">
                Not counted: {m.invalid > 0 && `${m.invalid} excluded attempt${m.invalid === 1 ? "" : "s"} (technical or consent reasons)`}
                {m.invalid > 0 && m.repeatsExcluded > 0 && " · "}
                {m.repeatsExcluded > 0 && `${m.repeatsExcluded} repeat attempt${m.repeatsExcluded === 1 ? "" : "s"}`}.
              </p>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="struggle">
        <h2 id="struggle" className="mb-3 text-lg font-semibold">
          Where did they struggle?
        </h2>
        {!d.behavior.available ? (
          <Card className="p-6 text-sm text-ink-muted">Paths and steps will appear here once participants' activity arrives from your website.</Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Pages participants visited" description="Number of attempts that viewed each page." />
              <ul className="space-y-3 p-5 sm:p-6">
                {d.behavior.topPages.map((p) => (
                  <li key={p.path}>
                    <div className="flex justify-between gap-3 text-sm">
                      <code className="truncate font-mono">{p.path}</code>
                      <span className="tabular-nums text-ink-muted">{p.attempts}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(4, (p.attempts / Math.max(1, d.metrics.attempts)) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            {d.behavior.funnel && (
              <Card>
                <CardHeader title="Milestones" description="How many attempts reached each step, in order." />
                <ol className="space-y-3 p-5 sm:p-6">
                  {d.behavior.funnel.map((f, i) => (
                    <li key={i} className="flex justify-between gap-3 text-sm">
                      <span>
                        {i + 1}. {f.label}
                      </span>
                      <span className="tabular-nums text-ink-muted">
                        {f.reached} of {f.previous}
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
            {!d.behavior.funnel && (
              <Card className="p-5 text-sm text-ink-muted sm:p-6">
                Open <Link to="participants" className="font-medium text-accent hover:underline">Participants</Link> to see each attempt's steps, repeated clicks and where it ended.
              </Card>
            )}
          </div>
        )}
        {d.analytics.posthogStatus !== "verified" && d.behavior.available && (
          <p className="mt-2 text-xs text-ink-muted">Calculated from activity stored by First Five. Detailed path analytics will be added when the analytics integration is connected.</p>
        )}
      </section>

      <section aria-labelledby="improve">
        <h2 id="improve" className="mb-3 text-lg font-semibold">
          What should I improve?
        </h2>
        <Card className="p-5 sm:p-6">
          {d.insights.latestReport ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">{d.insights.latestReport.title}</div>
                <div className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
                  <ReportBadge status={d.insights.latestReport.status} /> {d.insights.latestReport.findingCount} finding{d.insights.latestReport.findingCount === 1 ? "" : "s"}
                </div>
              </div>
              <LinkButton to={`/app/reports/${d.insights.latestReport.id}`} variant="secondary">
                Open report
              </LinkButton>
            </div>
          ) : (
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
              <div>
                <div className="font-medium">AI findings aren't available yet.</div>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  Behavioral metrics will appear as participants complete your test. AI research findings become available when the UX Director is connected.
                </p>
                <Link to="findings" className="mt-2 inline-block text-sm font-medium text-accent hover:underline">
                  Write your own findings
                </Link>
              </div>
            </div>
          )}
          {d.insights.uxDirectorStatus !== "verified" && d.insights.latestReport && (
            <p className="mt-3 text-xs text-ink-muted">
              <Pill>UX Director not connected</Pill>
            </p>
          )}
        </Card>
      </section>
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "success" | "warning" }) {
  return (
    <Card className="p-5">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-sm text-ink-muted">{sub}</div>}
    </Card>
  );
}

function Rate({ label, value, text, detail, empty }: { label: string; value?: number | null; text?: string | null; detail: string; empty: string }) {
  const display = text !== undefined ? text : value != null ? `${value}%` : null;
  return (
    <div>
      <div className="text-sm text-ink-muted">{label}</div>
      {display != null ? (
        <>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{display}</div>
          <div className="mt-0.5 text-sm text-ink-muted">{detail}</div>
        </>
      ) : (
        <>
          <div className="mt-1 text-2xl font-semibold text-slate-300">—</div>
          <div className="mt-0.5 text-sm text-ink-muted">{empty}</div>
        </>
      )}
    </div>
  );
}
