import { EVIDENCE_STRENGTH_LABELS, GOAL_TYPE_SHORT, type GoalType, type StudyMetrics } from "@firstfive/shared";
import { Eye, FlaskConical, Lightbulb, MessageSquareText, Target } from "lucide-react";
import type { ReactNode } from "react";
import { formatDuration } from "../lib/format";
import { Card, Pill } from "./ui";

export interface ViewFinding {
  title: string;
  observed: string;
  quotes: { text: string; who?: string }[];
  interpretation: string | null;
  evidenceStrength: "inconclusive" | "limited" | "supported";
  suggestion: string | null;
  retestMetric: string | null;
  affectedCount: number;
  counterCount: number;
  footer?: ReactNode;
}

export function strengthTone(s: ViewFinding["evidenceStrength"]) {
  return s === "supported" ? "success" : s === "limited" ? "warning" : "neutral";
}

export function MetricsSummary({ m }: { m: StudyMetrics }) {
  const finalizedNote = m.finalized === 0 ? "No finished attempts yet" : `of ${m.finalized} finished attempt${m.finalized === 1 ? "" : "s"}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricTile label="People tested" value={m.uniqueParticipants} sub={m.attempts !== m.uniqueParticipants ? `${m.attempts} attempts` : undefined} />
      <MetricTile label="Completed" value={m.completed} sub={m.completionRate.percent != null ? `${m.completionRate.percent}% ${finalizedNote}` : finalizedNote} tone="success" />
      <MetricTile label="Didn't complete" value={m.dropped} sub={m.dropRate.percent != null ? `${m.dropRate.percent}% ${finalizedNote}` : finalizedNote} tone="warning" />
      <MetricTile label="Median time to finish" value={m.medianCompletionMs != null ? formatDuration(m.medianCompletionMs) : "—"} sub={m.completed ? `Across ${m.completed} completed` : "Appears after a completion"} />
    </div>
  );
}

function MetricTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "success" | "warning" }) {
  return (
    <Card className="p-5">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-ink"}`}>{value}</div>
      {sub && <div className="mt-1 text-sm text-ink-muted">{sub}</div>}
    </Card>
  );
}

export function FindingCard({ f, index }: { f: ViewFinding; index?: number }) {
  return (
    <Card as="article" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-lg font-semibold leading-snug">
          {index != null && <span className="mr-2 text-ink-muted">{index + 1}.</span>}
          {f.title}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Pill tone={strengthTone(f.evidenceStrength)}>{EVIDENCE_STRENGTH_LABELS[f.evidenceStrength]}</Pill>
          <Pill>
            {f.affectedCount} attempt{f.affectedCount === 1 ? "" : "s"} affected
          </Pill>
        </div>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Section icon={Eye} title="What we observed">
          <p className="whitespace-pre-line">{f.observed}</p>
        </Section>
        <Section icon={MessageSquareText} title="What participants told us">
          {f.quotes.length ? (
            <ul className="space-y-2">
              {f.quotes.map((q, i) => (
                <li key={i} className="border-l-2 border-accent/40 pl-3 italic">
                  “{q.text}”{q.who && <span className="ml-1 not-italic text-ink-muted">— {q.who}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">We don't have an explanation from these participants.</p>
          )}
        </Section>
        <Section icon={Lightbulb} title="What this might mean">
          <p className="whitespace-pre-line">{f.interpretation || <span className="text-ink-muted">No interpretation added.</span>}</p>
          {f.counterCount > 0 && (
            <p className="mt-2 text-ink-muted">
              {f.counterCount} attempt{f.counterCount === 1 ? "" : "s"} showed the opposite.
            </p>
          )}
        </Section>
        <Section icon={FlaskConical} title="What to try next">
          <p className="whitespace-pre-line">{f.suggestion || <span className="text-ink-muted">No suggestion added.</span>}</p>
          {f.retestMetric && (
            <p className="mt-2 flex items-start gap-1.5 text-ink-muted">
              <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Retest: {f.retestMetric}
            </p>
          )}
        </Section>
      </div>
      {f.footer && <div className="mt-5 border-t border-line pt-4">{f.footer}</div>}
    </Card>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Eye; title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-sm leading-relaxed text-ink">
      <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-accent" aria-hidden /> {title}
      </h4>
      {children}
    </div>
  );
}

export function ReportDocument({
  banner,
  title,
  studyName,
  task,
  goalType,
  goalTarget,
  metrics,
  meta,
  summary,
  findings,
}: {
  banner?: ReactNode;
  title: string;
  studyName: string;
  task: string;
  goalType: GoalType;
  goalTarget: string;
  metrics: StudyMetrics;
  meta?: ReactNode;
  summary?: string | null;
  findings: ViewFinding[];
}) {
  return (
    <div className="space-y-8">
      {banner}
      <header>
        <div className="text-sm text-ink-muted">{studyName}</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-ink-muted">Task: </span>
            {task}
          </div>
          <div>
            <span className="text-ink-muted">Success condition: </span>
            {GOAL_TYPE_SHORT[goalType]} — <span className="font-mono text-[13px]">{goalTarget}</span>
          </div>
        </div>
        {meta && <div className="mt-2 text-sm text-ink-muted">{meta}</div>}
      </header>
      {summary && (
        <Card className="p-5 text-[15px] leading-relaxed">
          <p className="whitespace-pre-line">{summary}</p>
        </Card>
      )}
      <section aria-labelledby="results">
        <h2 id="results" className="mb-4 text-lg font-semibold">
          Did people succeed?
        </h2>
        <MetricsSummary m={metrics} />
        {metrics.attempts > 0 && metrics.attempts < 10 && (
          <p className="mt-3 text-sm text-ink-muted">Small samples are exploratory: they show what happened for these participants, not for all users.</p>
        )}
      </section>
      <section aria-labelledby="findings">
        <h2 id="findings" className="mb-4 text-lg font-semibold">
          What should I improve?
        </h2>
        {findings.length ? (
          <div className="space-y-4">
            {findings.map((f, i) => (
              <FindingCard key={i} f={f} index={i} />
            ))}
          </div>
        ) : (
          <Card className="p-6 text-sm text-ink-muted">No findings in this report.</Card>
        )}
      </section>
    </div>
  );
}
