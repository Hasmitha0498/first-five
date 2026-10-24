import type { ProjectSummary } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Globe, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { IntegrationBadge } from "../../components/status";
import { Alert, Card, EmptyState, ErrorState, LinkButton, PageHeader, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hostOf, timeAgo } from "../../lib/format";

function nextAction(p: ProjectSummary): { label: string; to: string } {
  switch (p.integrationStatus) {
    case "setup_not_started":
    case "awaiting_connection":
    case "connection_issue":
      return { label: "Connect your website", to: `/app/websites/${p.id}` };
    case "verification_needed":
      return { label: "Show us the journey", to: `/app/websites/${p.id}/journey` };
    case "connected":
      return p.studyCount === 0 ? { label: "Set up your first test", to: `/app/tests/new?website=${p.id}` } : { label: "View tests", to: `/app/websites/${p.id}/tests` };
  }
}

export function WebsitesPage() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: ProjectSummary[] }>("/api/projects") });
  const atLimit = me ? me.entitlement.usage.projects >= me.entitlement.maxProjects : false;

  const notices = (
    <>
      {params.get("welcome") && (
        <Alert tone="success" className="mb-6" title="Invitation code applied">
          Your account now has {params.get("welcome")}. A study credit is used when you launch a test.
        </Alert>
      )}
      {params.get("code_error") && (
        <Alert tone="warning" className="mb-6" title="Your account was created, but the invitation code couldn't be applied">
          You can try it again in <Link to="/app/settings" className="font-medium underline">Settings</Link>.
        </Alert>
      )}
    </>
  );

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const projects = q.data!.projects;

  if (projects.length === 0) {
    return (
      <>
        {notices}
        <Card className="mx-auto max-w-2xl">
          <EmptyState
            icon={Globe}
            title="Let's start with your website."
            description="Connect the product you want to test. You'll choose a specific feature or user journey afterward."
            action={
              <LinkButton to="/app/websites/new" size="lg" icon={Plus}>
                Connect a website
              </LinkButton>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {notices}
      <PageHeader
        title="Websites"
        description="The products you're testing with First Five."
        action={
          atLimit ? (
            <Link to="/access" className="text-sm font-medium text-accent hover:underline">
              Need another website? Get another study
            </Link>
          ) : (
            <LinkButton to="/app/websites/new" icon={Plus}>
              Connect a website
            </LinkButton>
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => {
          const action = nextAction(p);
          return (
            <Card key={p.id} className="flex flex-col p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/app/websites/${p.id}`} className="block truncate text-lg font-semibold hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    {p.name}
                  </Link>
                  <div className="mt-0.5 truncate text-sm text-ink-muted">{hostOf(p.websiteUrl)}</div>
                </div>
                <IntegrationBadge status={p.integrationStatus} />
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-ink-muted">Tests</dt>
                  <dd className="mt-0.5 font-medium">{p.studyCount}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Last activity</dt>
                  <dd className="mt-0.5 font-medium">{p.lastActivityAt ? timeAgo(p.lastActivityAt) : "None yet"}</dd>
                </div>
              </dl>
              <div className="mt-5 border-t border-line pt-4">
                <Link to={action.to} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                  {action.label} <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
