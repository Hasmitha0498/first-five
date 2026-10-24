import { GOAL_TYPE_LABELS, TIME_LIMIT_OPTIONS_SECONDS, type DiscoveryResponse, type GoalType, type ProjectSummary, type StudyDetail } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "../../components/ui";
import { IntegrationBadge } from "../../components/status";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatMinutes } from "../../lib/format";

const MANUAL = "__manual__";

export interface TestFormValues {
  projectId: string;
  name: string;
  task: string;
  startPath: string;
  goalType: GoalType;
  goalTarget: string;
  goalPagePath?: string;
  timeLimitSeconds: number;
  participantLimit: number;
  milestones: { label: string; type: GoalType; target: string }[];
  expiresAt: string | null;
  repeatPolicy: "flag_repeats" | "block_repeats";
}

export function initialValues(study?: StudyDetail, projectId?: string): TestFormValues {
  if (study) {
    const v = study.currentVersion;
    return {
      projectId: study.projectId,
      name: study.name,
      task: v.task,
      startPath: v.startPath,
      goalType: v.goalType,
      goalTarget: v.goalTarget,
      goalPagePath: v.goalPagePath ?? undefined,
      timeLimitSeconds: v.timeLimitSeconds,
      participantLimit: study.participantLimit,
      milestones: v.milestones,
      expiresAt: study.expiresAt,
      repeatPolicy: v.repeatPolicy === "block_repeats" ? "block_repeats" : "flag_repeats",
    };
  }
  return {
    projectId: projectId ?? "",
    name: "",
    task: "",
    startPath: "/",
    goalType: "page_reached",
    goalTarget: "",
    timeLimitSeconds: 300,
    participantLimit: 5,
    milestones: [],
    expiresAt: null,
    repeatPolicy: "flag_repeats",
  };
}

export function TestForm({
  initial,
  lockedProject,
  submitLabel,
  onSubmit,
}: {
  initial: TestFormValues;
  lockedProject?: boolean;
  submitLabel: string;
  onSubmit: (values: TestFormValues) => Promise<void>;
}) {
  const { me } = useAuth();
  const [v, setV] = useState<TestFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [advanced, setAdvanced] = useState(initial.milestones.length > 0 || initial.expiresAt != null || initial.repeatPolicy !== "flag_repeats");
  const set = <K extends keyof TestFormValues>(k: K, value: TestFormValues[K]) => setV((s) => ({ ...s, [k]: value }));

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: ProjectSummary[] }>("/api/projects") });
  const discovery = useQuery({
    queryKey: ["discovery", v.projectId],
    queryFn: () => api<DiscoveryResponse>(`/api/projects/${v.projectId}/discovery`),
    enabled: Boolean(v.projectId),
  });

  useEffect(() => {
    if (!v.projectId && projects.data?.projects.length) set("projectId", projects.data.projects[0]!.id);
  }, [projects.data, v.projectId]);

  const pages = discovery.data?.pages ?? [];
  const elements = discovery.data?.elements ?? [];
  const customEvents = discovery.data?.customEvents ?? [];
  const selectedProject = projects.data?.projects.find((p) => p.id === v.projectId);

  const startKnown = pages.some((p) => p.path === v.startPath);
  const [startManual, setStartManual] = useState(!startKnown && initial.startPath !== "/");
  const targetKnown = useMemo(() => {
    if (v.goalType === "page_reached") return pages.some((p) => p.path === v.goalTarget);
    if (v.goalType === "element_clicked") return elements.some((e) => e.elementKey === v.goalTarget && (!v.goalPagePath || e.pagePath === v.goalPagePath));
    return customEvents.some((c) => c.eventName === v.goalTarget);
  }, [v.goalType, v.goalTarget, v.goalPagePath, pages, elements, customEvents]);
  const [targetManual, setTargetManual] = useState(false);
  const showStartManual = startManual || pages.length === 0;
  const showTargetManual = targetManual || (v.goalType === "page_reached" ? pages.length === 0 : v.goalType === "element_clicked" ? elements.length === 0 : customEvents.length === 0);

  const maxParticipants = me?.entitlement.maxParticipantsPerStudy ?? 5;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFields({});
    try {
      await onSubmit({ ...v, goalPagePath: v.goalType === "element_clicked" ? v.goalPagePath || undefined : undefined });
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      <Card className="space-y-5 p-5 sm:p-6">
        {!lockedProject && (
          <Field label="Website" error={fields.projectId}>
            {(p) => (
              <Select {...p} value={v.projectId} onChange={(e) => set("projectId", e.target.value)}>
                {projects.data?.projects.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {selectedProject && selectedProject.integrationStatus !== "connected" && (
          <Alert tone="info" title="You can save this test as a draft">
            <span className="inline-flex flex-wrap items-center gap-2">
              Launching it needs a connected website. Current status: <IntegrationBadge status={selectedProject.integrationStatus} />
            </span>
          </Alert>
        )}
        <Field label="Give your test a name" hint="Example: Onboarding test" error={fields.name}>
          {(p) => <Input {...p} maxLength={80} value={v.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label="What should someone be able to do?" hint="Participants see this as their task. Example: Create an account and reach the dashboard." error={fields.task}>
          {(p) => <Textarea {...p} rows={2} maxLength={400} value={v.task} onChange={(e) => set("task", e.target.value)} />}
        </Field>
      </Card>

      <Card className="space-y-5 p-5 sm:p-6">
        <Field
          label="Where should they begin?"
          hint={showStartManual ? "Enter a page path. Paths you type are unverified until we see them on your website." : "Pages we've seen on your website."}
          error={fields.startPath}
        >
          {(p) =>
            showStartManual ? (
              <Input {...p} className="font-mono" placeholder="/signup" value={v.startPath} onChange={(e) => set("startPath", e.target.value)} />
            ) : (
              <Select
                {...p}
                value={startKnown ? v.startPath : MANUAL}
                onChange={(e) => (e.target.value === MANUAL ? setStartManual(true) : set("startPath", e.target.value))}
              >
                {!startKnown && <option value={MANUAL}>Choose a page…</option>}
                {pages.map((pg) => (
                  <option key={pg.path} value={pg.path}>
                    {pg.path}
                  </option>
                ))}
                <option value={MANUAL}>Enter a path manually (unverified)</option>
              </Select>
            )
          }
        </Field>
        {showStartManual && pages.length > 0 && (
          <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setStartManual(false)}>
            Choose from discovered pages instead
          </button>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">How will we know they succeeded?</legend>
          <div className="grid gap-2">
            {(Object.keys(GOAL_TYPE_LABELS) as GoalType[]).map((g) => (
              <label
                key={g}
                className={clsx(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-accent",
                  v.goalType === g ? "border-accent bg-accent-soft/60" : "border-line hover:bg-canvas",
                )}
              >
                <input
                  type="radio"
                  name="goalType"
                  value={g}
                  checked={v.goalType === g}
                  onChange={() => {
                    setV((s) => ({ ...s, goalType: g, goalTarget: "", goalPagePath: undefined }));
                    setTargetManual(false);
                  }}
                  className="h-4 w-4 accent-accent"
                />
                {GOAL_TYPE_LABELS[g]}
              </label>
            ))}
          </div>
          {v.goalType === "element_clicked" && (
            <p className="mt-2 text-sm text-ink-muted">This measures the click itself — for example, clicking “Pay now” isn't the same as a completed payment.</p>
          )}
        </fieldset>

        <Field
          label={v.goalType === "page_reached" ? "Destination page" : v.goalType === "element_clicked" ? "Button or link" : "Completion event name"}
          hint={
            showTargetManual
              ? v.goalType === "custom_event"
                ? "The event your website sends when the task is done, e.g. signup_completed. Unverified until we receive it."
                : "Unverified until we see it on your website."
              : targetKnown
                ? "Seen on your website."
                : undefined
          }
          error={fields.goalTarget}
        >
          {(p) =>
            showTargetManual ? (
              <Input
                {...p}
                className="font-mono"
                placeholder={v.goalType === "page_reached" ? "/dashboard" : v.goalType === "element_clicked" ? "create-account" : "signup_completed"}
                value={v.goalTarget}
                onChange={(e) => set("goalTarget", e.target.value)}
              />
            ) : (
              <Select
                {...p}
                value={targetKnown ? (v.goalType === "element_clicked" ? `${v.goalPagePath ?? ""}::${v.goalTarget}` : v.goalTarget) : ""}
                onChange={(e) => {
                  if (e.target.value === MANUAL) return setTargetManual(true);
                  if (v.goalType === "element_clicked") {
                    const [page, key] = e.target.value.split("::");
                    setV((s) => ({ ...s, goalTarget: key ?? "", goalPagePath: page || undefined }));
                  } else set("goalTarget", e.target.value);
                }}
              >
                <option value="">Choose…</option>
                {v.goalType === "page_reached" &&
                  pages.map((pg) => (
                    <option key={pg.path} value={pg.path}>
                      {pg.path}
                    </option>
                  ))}
                {v.goalType === "element_clicked" &&
                  elements.map((el) => (
                    <option key={el.id} value={`${el.pagePath}::${el.elementKey}`}>
                      {el.safeLabel ?? el.elementKey} — {el.pagePath}
                    </option>
                  ))}
                {v.goalType === "custom_event" &&
                  customEvents.map((c) => (
                    <option key={c.eventName} value={c.eventName}>
                      {c.eventName}
                    </option>
                  ))}
                <option value={MANUAL}>Enter manually (unverified)</option>
              </Select>
            )
          }
        </Field>
      </Card>

      <Card className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <Field label="How long should they have?" error={fields.timeLimitSeconds}>
          {(p) => (
            <Select {...p} value={v.timeLimitSeconds} onChange={(e) => set("timeLimitSeconds", Number(e.target.value))}>
              {TIME_LIMIT_OPTIONS_SECONDS.map((s) => (
                <option key={s} value={s}>
                  {formatMinutes(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="How many people should test this?" hint={`Up to ${maxParticipants} on your plan.`} error={fields.participantLimit}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              max={maxParticipants}
              value={v.participantLimit}
              onChange={(e) => set("participantLimit", Math.max(1, Number(e.target.value) || 1))}
            />
          )}
        </Field>
      </Card>

      <Card>
        <button
          type="button"
          className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-6"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
        >
          Advanced settings
          {advanced ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
        {advanced && (
          <div className="space-y-5 border-t border-line p-5 sm:p-6">
            <div>
              <div className="text-sm font-medium">Milestones (optional)</div>
              <p className="mt-0.5 text-sm text-ink-muted">Add 2–5 steps in order to see how far people get. Without milestones we show the paths people actually took.</p>
              <div className="mt-3 space-y-2">
                {v.milestones.map((m, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_11rem_1fr_auto]">
                    <Input aria-label={`Milestone ${i + 1} label`} placeholder="Label" value={m.label} onChange={(e) => set("milestones", v.milestones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Select aria-label={`Milestone ${i + 1} type`} value={m.type} onChange={(e) => set("milestones", v.milestones.map((x, j) => (j === i ? { ...x, type: e.target.value as GoalType } : x)))}>
                      <option value="page_reached">Page reached</option>
                      <option value="element_clicked">Element clicked</option>
                      <option value="custom_event">Custom event</option>
                    </Select>
                    <Input aria-label={`Milestone ${i + 1} target`} className="font-mono" placeholder="/step-2" value={m.target} onChange={(e) => set("milestones", v.milestones.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
                    <Button variant="ghost" icon={Trash2} aria-label={`Remove milestone ${i + 1}`} onClick={() => set("milestones", v.milestones.filter((_, j) => j !== i))} />
                  </div>
                ))}
                {v.milestones.length < 5 && (
                  <Button variant="secondary" size="sm" icon={Plus} onClick={() => set("milestones", [...v.milestones, { label: "", type: "page_reached", target: "" }])}>
                    Add milestone
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Stop accepting participants after" optional error={fields.expiresAt}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={v.expiresAt ? v.expiresAt.slice(0, 10) : ""}
                    onChange={(e) => set("expiresAt", e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null)}
                  />
                )}
              </Field>
              <Field label="If someone opens the link again">
                {(p) => (
                  <Select {...p} value={v.repeatPolicy} onChange={(e) => set("repeatPolicy", e.target.value as TestFormValues["repeatPolicy"])}>
                    <option value="flag_repeats">Allow it, but exclude it from results</option>
                    <option value="block_repeats">Don't allow another attempt</option>
                  </Select>
                )}
              </Field>
            </div>
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
