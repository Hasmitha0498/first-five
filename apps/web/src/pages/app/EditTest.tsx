import type { StudyDetail } from "@firstfive/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, ErrorState, PageHeader, Spinner } from "../../components/ui";
import { api, ApiError, errorMessage, patch } from "../../lib/api";
import { initialValues, TestForm } from "./TestForm";

export function EditTestPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["study", id], queryFn: () => api<StudyDetail>(`/api/studies/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} />;
  const study = q.data!;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={<Link to={`/app/tests/${study.id}`} className="hover:text-ink">← {study.name}</Link>} title="Edit test" />
      {study.hasParticipants && (
        <Alert tone="info" className="mb-6" title="Participants have already started this test">
          Changing the task, start page or success condition saves a new version, so earlier results stay accurate. The new version needs to be launched again.
        </Alert>
      )}
      <TestForm
        initial={initialValues(study)}
        lockedProject
        submitLabel="Save changes"
        onSubmit={async (values) => {
          const { projectId: _ignored, ...rest } = values;
          try {
            await patch<StudyDetail>(`/api/studies/${study.id}`, rest);
          } catch (err) {
            if (err instanceof ApiError && err.code === "version_locked") {
              if (!window.confirm("Participants have already started this test. Save these changes as a new version?")) return;
              await patch<StudyDetail>(`/api/studies/${study.id}`, { ...rest, createNewVersion: true });
            } else throw err;
          }
          await qc.invalidateQueries({ queryKey: ["study", study.id] });
          await qc.invalidateQueries({ queryKey: ["dashboard", study.id] });
          navigate(`/app/tests/${study.id}`);
        }}
      />
    </div>
  );
}
