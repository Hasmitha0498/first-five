import type { FeedbackQuestionDto, FeedbackSessionResponse } from "@firstfive/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { ParticipantLayout } from "../../components/layouts";
import { Alert, Button, Card, Spinner, Textarea } from "../../components/ui";
import { api, errorMessage, post } from "../../lib/api";

/** Reads the one-time handoff from the URL fragment, keeps it in this tab only, and removes it from the address bar. */
function useFeedbackToken(studyId: string) {
  const key = `ff_fb_${studyId}`;
  const [token] = useState<string | null>(() => {
    const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("h");
    if (fromHash) {
      try {
        sessionStorage.setItem(key, fromHash);
      } catch {
        // storage unavailable: keep it in memory only
      }
      return fromHash;
    }
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);
  return token;
}

type Answer = { status: "answered" | "skipped"; choice?: string; text?: string };

export function FeedbackPage() {
  const { studyId = "" } = useParams();
  const token = useFeedbackToken(studyId);
  const headers = token ? { "x-ff-feedback": token } : undefined;
  const q = useQuery({
    queryKey: ["feedback", studyId, token],
    queryFn: () => api<FeedbackSessionResponse>(`/api/public/studies/${studyId}/feedback`, { headers }),
    enabled: Boolean(token),
  });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const submit = useMutation({
    mutationFn: (payload: { questionKey: string; status: "answered" | "skipped"; choice?: string; text?: string }[]) =>
      api(`/api/public/studies/${studyId}/feedback`, { method: "POST", body: { answers: payload }, headers }),
  });

  if (!token) {
    return (
      <ParticipantLayout>
        <Card className="p-6 text-center sm:p-10">
          <h1 className="text-xl font-semibold">This feedback link isn't valid</h1>
          <p className="mt-2 text-ink-muted">Please return to the test tab and choose “I've finished”.</p>
        </Card>
      </ParticipantLayout>
    );
  }
  if (q.isLoading)
    return (
      <ParticipantLayout>
        <Spinner />
      </ParticipantLayout>
    );
  if (q.error)
    return (
      <ParticipantLayout>
        <Card className="p-6 sm:p-8">
          <Alert tone="danger">{errorMessage(q.error)}</Alert>
        </Card>
      </ParticipantLayout>
    );

  const data = q.data!;
  if (submit.isSuccess || data.alreadySubmitted) {
    return (
      <ParticipantLayout>
        <Card className="p-6 text-center sm:p-10">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Thank you — you're all done.</h1>
          <p className="mt-2 text-ink-muted">Your answers have been saved. You can close this tab.</p>
        </Card>
      </ParticipantLayout>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate(
      data.questions.map((qq) => {
        const a = answers[qq.key];
        const hasValue = a && (a.choice || a.text?.trim());
        return hasValue ? { questionKey: qq.key, status: "answered" as const, choice: a.choice, text: a.text?.trim() } : { questionKey: qq.key, status: "skipped" as const };
      }),
    );
  };

  return (
    <ParticipantLayout>
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Thanks for testing. Three quick questions.</h1>
        <p className="mt-2 text-ink-muted">Every question is optional. There are no right or wrong answers.</p>
        <form onSubmit={onSubmit} className="mt-8 space-y-8" noValidate>
          {data.questions.map((qq) => (
            <Question key={qq.key} q={qq} value={answers[qq.key]} onChange={(a) => setAnswers((s) => ({ ...s, [qq.key]: a }))} />
          ))}
          {submit.error && <Alert tone="danger">{errorMessage(submit.error)}</Alert>}
          <Button type="submit" size="lg" loading={submit.isPending} className="w-full sm:w-auto">
            Submit feedback
          </Button>
        </form>
      </Card>
    </ParticipantLayout>
  );
}

function Question({ q, value, onChange }: { q: FeedbackQuestionDto; value?: Answer; onChange: (a: Answer) => void }) {
  const id = `q-${q.key}`;
  if (q.kind === "ease_scale") {
    return (
      <fieldset>
        <legend className="text-base font-semibold">
          {q.position}. {q.text}
        </legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {q.options!.map((o) => (
            <label
              key={o.value}
              className={clsx(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-[15px] transition-colors focus-within:ring-2 focus-within:ring-accent",
                value?.choice === o.value ? "border-accent bg-accent-soft/60" : "border-line hover:bg-canvas",
              )}
            >
              <input type="radio" name={id} value={o.value} checked={value?.choice === o.value} onChange={() => onChange({ status: "answered", choice: o.value })} className="h-4 w-4 accent-accent" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="block text-base font-semibold">
        {q.position}. {q.text}
      </label>
      <Textarea id={id} className="mt-3" rows={4} maxLength={2000} value={value?.text ?? ""} onChange={(e) => onChange({ status: "answered", text: e.target.value })} placeholder="Type your answer, or leave blank to skip" />
    </div>
  );
}
