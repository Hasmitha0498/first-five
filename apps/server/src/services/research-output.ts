/**
 * Validation of structured UX Director output (PRD §9.5) before anything is
 * stored. Rejects unknown evidence references and counts that disagree with the
 * backend — the agent never decides numbers.
 */
import { z } from "zod";

export const ResearchOutputSchema = z.object({
  study_id: z.string(),
  snapshot_id: z.string(),
  individual_findings: z
    .array(
      z.object({
        session_id: z.string(),
        observed: z.array(z.string().max(500)).max(20),
        reported: z.array(z.string().max(1000)).max(20),
        hypotheses: z.array(z.string().max(500)).max(10),
        evidence_event_ids: z.array(z.string()).max(50),
        feedback_response_ids: z.array(z.string()).max(10),
        limitations: z.array(z.string().max(300)).max(10),
      }),
    )
    .max(200),
  aggregate_findings: z
    .array(
      z.object({
        issue: z.string().min(3).max(200),
        affected_session_ids: z.array(z.string()).max(200),
        affected_count_from_backend: z.number().int().nonnegative(),
        evidence_strength: z.enum(["inconclusive", "limited", "supported"]),
        counterexamples: z.array(z.string()).max(200),
        recommendation: z.string().max(2000),
        success_measure: z.string().max(500),
      }),
    )
    .max(30),
  approval_status: z.string(),
});
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

export interface EvidenceScope {
  studyPublicId: string;
  sessionPublicIds: Set<string>;
  eventIdsBySession: Map<string, Set<string>>;
  responseIdsBySession: Map<string, Set<string>>;
}

export function validateResearchOutput(raw: unknown, scope: EvidenceScope): { ok: true; output: ResearchOutput } | { ok: false; errors: string[] } {
  const parsed = ResearchOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const out = parsed.data;
  const errors: string[] = [];
  if (out.study_id !== scope.studyPublicId) errors.push("study_id does not match the requested study");
  out.individual_findings.forEach((f, i) => {
    if (!scope.sessionPublicIds.has(f.session_id)) errors.push(`individual_findings[${i}]: unknown session ${f.session_id}`);
    const events = scope.eventIdsBySession.get(f.session_id) ?? new Set();
    f.evidence_event_ids.filter((id) => !events.has(id)).forEach((id) => errors.push(`individual_findings[${i}]: event ${id} is not in that session`));
    const responses = scope.responseIdsBySession.get(f.session_id) ?? new Set();
    f.feedback_response_ids.filter((id) => !responses.has(id)).forEach((id) => errors.push(`individual_findings[${i}]: response ${id} is not in that session`));
  });
  out.aggregate_findings.forEach((f, i) => {
    const unknown = [...f.affected_session_ids, ...f.counterexamples].filter((id) => !scope.sessionPublicIds.has(id));
    unknown.forEach((id) => errors.push(`aggregate_findings[${i}]: unknown session ${id}`));
    const distinct = new Set(f.affected_session_ids).size;
    if (f.affected_count_from_backend !== distinct) {
      errors.push(`aggregate_findings[${i}]: affected count ${f.affected_count_from_backend} doesn't match ${distinct} cited sessions`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, output: out };
}
