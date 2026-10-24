import type { StudyDetail } from "@firstfive/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { initialValues, TestForm } from "./TestForm";

export function NewTestPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={<Link to="/app/tests" className="hover:text-ink">← Tests</Link>}
        title="Set up your test"
        description="Choose one task for participants to try. You can save it as a draft and launch when your website is connected."
      />
      <TestForm
        initial={initialValues(undefined, params.get("website") ?? undefined)}
        submitLabel="Save test"
        onSubmit={async (values) => {
          const study = await post<StudyDetail>("/api/studies", values);
          await Promise.all([qc.invalidateQueries({ queryKey: ["studies"] }), refresh()]);
          navigate(`/app/tests/${study.id}`);
        }}
      />
    </div>
  );
}
