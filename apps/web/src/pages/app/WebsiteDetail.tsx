import { INTEGRATION_STATUS_HELP, type ConnectionCheck, type DiscoveryResponse, type ProjectDetail, type SetupLaunchResponse, type StudySummary } from "@firstfive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileSearch, MousePointerClick, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { IntegrationBadge, StudyBadge } from "../../components/status";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Pill,
  Spinner,
  Tabs,
} from "../../components/ui";
import { api, del, errorMessage, fieldErrors, post } from "../../lib/api";
import { formatDateTime, hostOf, timeAgo } from "../../lib/format";

export function WebsiteDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["project", id], queryFn: () => api<ProjectDetail>(`/api/projects/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const p = q.data!;
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/app/websites" className="hover:text-ink">← Websites</Link>}
        title={p.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <a href={p.websiteUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-ink">
              {hostOf(p.websiteUrl)} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
            <IntegrationBadge status={p.integrationStatus} />
          </span>
        }
        action={
          p.integrationStatus === "connected" ? (
            <LinkButton to={`/app/tests/new?website=${p.id}`} icon={Plus}>
              Set up a test
            </LinkButton>
          ) : undefined
        }
      />
      <div className="mb-6">
        <Tabs
          tabs={[
            { to: `/app/websites/${p.id}`, label: "Connect", end: true },
            { to: `/app/websites/${p.id}/journey`, label: "Journey" },
            { to: `/app/websites/${p.id}/tests`, label: "Tests", count: p.studyCount },
            { to: `/app/websites/${p.id}/settings`, label: "Settings" },
          ]}
        />
      </div>
      <Routes>
        <Route index element={<InstallTab project={p} />} />
        <Route path="journey" element={<JourneyTab project={p} />} />
        <Route path="tests" element={<WebsiteTestsTab project={p} />} />
        <Route path="settings" element={<WebsiteSettingsTab project={p} />} />
      </Routes>
    </>
  );
}

function InstallTab({ project: p }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const markCopied = () => {
    post(`/api/projects/${p.id}/snippet-copied`).then(() => qc.invalidateQueries({ queryKey: ["project", p.id] }));
  };
  const checkMut = useMutation({
    mutationFn: () => post<ConnectionCheck>(`/api/projects/${p.id}/check-connection`),
    onSuccess: (r) => {
      setCheck(r);
      qc.invalidateQueries({ queryKey: ["project", p.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const status = check?.integrationStatus ?? p.integrationStatus;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Add First Five to your website" description="Copy this code into your website's shared layout, then publish the update." />
          <div className="space-y-4 p-5 sm:p-6">
            {p.snippet.isPreview && (
              <Alert tone="warning" title="Setup preview">
                The First Five script address hasn't been configured on this server yet, so this snippet shows a placeholder address. Your project ID is
                real and won't change.
              </Alert>
            )}
            <CodeBlock code={p.snippet.html} label="Installation snippet" />
            <div className="flex flex-wrap gap-2">
              <CopyButton text={p.snippet.html} label="Copy code" copiedLabel="Code copied" variant="primary" size="md" onCopied={markCopied} />
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
              <li>Paste the code into the layout that every page of your website shares (for example, inside the &lt;head&gt;).</li>
              <li>Publish or deploy the change.</li>
              <li>Come back here and choose “Check connection”.</li>
            </ol>
          </div>
        </Card>
        <Card>
          <CardHeader title="Using an AI coding assistant?" description="Paste this prompt into Claude Code, Lovable, Cursor or similar." />
          <div className="space-y-3 p-5 sm:p-6">
            <div className="rounded-lg border border-line bg-canvas p-4 text-sm leading-relaxed text-ink-soft whitespace-pre-line">{p.snippet.assistantPrompt}</div>
            <CopyButton text={p.snippet.assistantPrompt} label="Copy prompt" onCopied={markCopied} />
          </div>
        </Card>
      </div>
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Connection status</h2>
          <div className="mt-3">
            <IntegrationBadge status={status} />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{INTEGRATION_STATUS_HELP[status]}</p>
          {(check?.lastIssue ?? p.lastIssue) && status === "connection_issue" && (
            <Alert tone="danger" className="mt-3">
              {check?.lastIssue ?? p.lastIssue}
            </Alert>
          )}
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Script loaded</dt>
              <dd>{timeAgo(check?.lastConfigPingAt ?? p.lastConfigPingAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Last activity</dt>
              <dd>{timeAgo(check?.lastActivityAt ?? p.lastActivityAt)}</dd>
            </div>
          </dl>
          <Button className="mt-4 w-full" variant="secondary" icon={RefreshCw} loading={checkMut.isPending} onClick={() => checkMut.mutate()}>
            Check connection
          </Button>
          {checkMut.error && <p className="mt-2 text-sm text-danger">{errorMessage(checkMut.error)}</p>}
          {check && <p className="mt-2 text-xs text-ink-muted">Checked {formatDateTime(check.checkedAt)}</p>}
          {status === "verification_needed" && (
            <LinkButton to={`/app/websites/${p.id}/journey`} className="mt-3 w-full">
              Show us the journey
            </LinkButton>
          )}
        </Card>
        <Card className="p-5 text-sm">
          <h2 className="font-semibold">Project ID</h2>
          <p className="mt-1 text-ink-muted">Public identifier for this website. It isn't a password.</p>
          <code className="mt-2 block break-all rounded bg-canvas px-2 py-1 font-mono text-[13px]">{p.publicId}</code>
        </Card>
      </div>
    </div>
  );
}

function JourneyTab({ project: p }: { project: ProjectDetail }) {
  const q = useQuery({
    queryKey: ["discovery", p.id],
    queryFn: () => api<DiscoveryResponse>(`/api/projects/${p.id}/discovery`),
    refetchInterval: (query) => (query.state.data?.activeSetupSession ? 5000 : false),
  });
  const [launch, setLaunch] = useState<SetupLaunchResponse | null>(null);
  const start = useMutation({
    mutationFn: () => post<SetupLaunchResponse>(`/api/projects/${p.id}/setup-sessions`),
    onSuccess: (r) => {
      setLaunch(r);
      window.open(r.launchUrl, "_blank", "noopener,noreferrer");
      q.refetch();
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const elementsByPage = d.elements.reduce<Record<string, typeof d.elements>>((acc, e) => {
    (acc[e.pagePath] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Show us the journey you want to test"
          description="Open your website and walk through the part you want to test. We'll use the activity we receive to help you choose a starting point and goal."
        />
        <div className="flex flex-wrap items-center gap-3 p-5 sm:p-6">
          <Button icon={ExternalLink} loading={start.isPending} onClick={() => start.mutate()}>
            Open my website
          </Button>
          {d.activeSetupSession && <Pill tone="info" dot>Walkthrough open · {d.activeSetupSession.eventCount} activities received</Pill>}
          {start.error && <p className="w-full text-sm text-danger">{errorMessage(start.error)}</p>}
          {launch && (
            <p className="w-full text-sm text-ink-muted">
              If a new tab didn't open,{" "}
              <a href={launch.launchUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-accent underline">
                open your website here
              </a>
              . This link works once and expires in 10 minutes.
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="text-sm text-ink-muted">Pages discovered</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{d.pages.length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-ink-muted">Buttons and links discovered</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{d.elements.length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-ink-muted">Last activity received</div>
          <div className="mt-1 text-lg font-semibold">{timeAgo(d.lastActivityAt)}</div>
          <div className="mt-1">
            <IntegrationBadge status={d.integrationStatus} />
          </div>
        </Card>
      </div>

      {d.pages.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileSearch}
            title="We haven't discovered any pages yet."
            description="Once First Five is connected, open your website and walk through the journey you want to test."
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title="What we've seen" description="Only pages and elements actually observed during your walkthrough appear here." />
          <ul className="divide-y divide-line">
            {d.pages.map((page) => (
              <li key={page.path} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="font-mono text-sm font-medium">{page.path}</code>
                  <span className="text-xs text-ink-muted">Last seen {timeAgo(page.lastSeenAt)}</span>
                </div>
                {elementsByPage[page.path]?.length ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {elementsByPage[page.path]!.map((e) => (
                      <li key={e.id} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-1 text-xs">
                        {e.wasClicked && <MousePointerClick className="h-3 w-3 text-accent" aria-label="Clicked during walkthrough" />}
                        <span className="font-medium">{e.safeLabel ?? e.elementKey}</span>
                        <span className="text-ink-muted">· {e.elementType}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-muted">No interactive elements reported on this page.</p>
                )}
              </li>
            ))}
          </ul>
          {d.customEvents.length > 0 && (
            <div className="border-t border-line px-5 py-4 text-sm sm:px-6">
              <span className="font-medium">Custom completion events seen: </span>
              {d.customEvents.map((c) => (
                <code key={c.eventName} className="mr-2 font-mono text-[13px]">
                  {c.eventName}
                </code>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function WebsiteTestsTab({ project: p }: { project: ProjectDetail }) {
  const q = useQuery({ queryKey: ["project-studies", p.id], queryFn: () => api<{ studies: StudySummary[] }>(`/api/projects/${p.id}/studies`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} />;
  const studies = q.data!.studies;
  if (!studies.length) {
    return (
      <Card>
        <EmptyState
          icon={Plus}
          title="What would you like to test first?"
          description="Choose one important task, like signing up or checking out."
          action={<LinkButton to={`/app/tests/new?website=${p.id}`}>Set up a test</LinkButton>}
        />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-line">
        {studies.map((s) => (
          <li key={s.id}>
            <Link to={`/app/tests/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none sm:px-6">
              <span className="font-medium">{s.name}</span>
              <span className="flex items-center gap-3 text-sm text-ink-muted">
                {s.participantCount} of {s.participantLimit} participants
                <StudyBadge status={s.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WebsiteSettingsTab({ project: p }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => post<ProjectDetail>(`/api/projects/${p.id}/origins`, { origin }),
    onSuccess: () => {
      setOrigin("");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["project", p.id] });
    },
    onError: (e) => setErr(fieldErrors(e).websiteUrl ?? errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (o: string) => del<ProjectDetail>(`/api/projects/${p.id}/origins`, { origin: o }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", p.id] }),
  });
  const destroy = useMutation({
    mutationFn: () => del(`/api/projects/${p.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate("/app/websites");
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Allowed website addresses" description="First Five only accepts activity from these addresses. Add others if your product runs on more than one domain." />
        <ul className="divide-y divide-line">
          {p.origins.map((o) => (
            <li key={o.origin} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm sm:px-6">
              <code className="font-mono">{o.origin}</code>
              <span className="flex items-center gap-3">
                {o.verifiedAt ? <Pill tone="success">Activity received</Pill> : <Pill>No activity yet</Pill>}
                {o.origin !== p.canonicalOrigin && (
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${o.origin}`} onClick={() => remove.mutate(o.origin)} />
                )}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-t border-line p-5 sm:px-6">
          <div className="min-w-[16rem] flex-1">
            <Field label="Add an address" error={err ?? undefined}>
              {(f) => <Input {...f} placeholder="https://app.example.com" value={origin} onChange={(e) => setOrigin(e.target.value)} />}
            </Field>
          </div>
          <Button type="submit" variant="secondary" loading={add.isPending} disabled={!origin.trim()}>
            Add
          </Button>
        </form>
      </Card>
      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold">Delete this website</h2>
        <p className="mt-1 text-sm text-ink-muted">Deletes the website, its tests, participant results and reports. This can't be undone.</p>
        <Button
          variant="danger"
          className="mt-4"
          icon={Trash2}
          loading={destroy.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${p.name} and all of its tests and results? This can't be undone.`)) destroy.mutate();
          }}
        >
          Delete website
        </Button>
        {destroy.error && <p className="mt-2 text-sm text-danger">{errorMessage(destroy.error)}</p>}
      </Card>
    </div>
  );
}
