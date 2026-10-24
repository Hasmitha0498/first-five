/**
 * AgenticOrg "UX Director" connector.
 *
 * Verified against the hackathon workspace on 24 Oct 2026:
 *  - Agents run by stored agent ID: POST /api/v1/agents/{id}/run with a JSON body
 *    {action, inputs, context} and a Bearer execution key. Runs are synchronous.
 *  - The response carries run_id, correlation_id, status ("completed" |
 *    "hitl_triggered" | "failed"), output and confidence.
 *  - `output` is either the agent's JSON already parsed into an object, or
 *    {raw_output: string} where the string may be a Python-repr'd content block
 *    ("{'type': 'text', 'text': '<json>'}").
 *  - Every report run queues an AgenticOrg HITL approval whose
 *    context.correlation_id equals the run's correlation_id. Reading approvals
 *    needs a key with approvals:read (AGENTICORG_APPROVALS_API_KEY).
 * No agent run, contextual question or approval is ever fabricated.
 */
import type { AppConfig } from "../config";
import type { HealthResult } from "./posthog";

export interface AgentEvent {
  event_id: string;
  seq: number | null;
  name: string;
  route: string | null;
  element_key: string | null;
  element_type: string | null;
  element_label: string | null;
  t_ms_from_start: number;
}

export interface SessionSummaryForQuestion {
  sessionPublicId: string;
  task: string;
  goal: { type: string; target: string };
  outcome: "completed" | "dropped" | "pending" | "invalid";
  events: AgentEvent[];
}

export interface ContextualQuestion {
  question: string;
  evidenceEventId: string | null;
  externalRunId: string;
  hitlTriggered: boolean;
}

/** Input contract of the ff_ux_director agent (apps docs: AGENTICORG_SETUP.md §4). */
export interface EvidencePackage {
  study: {
    study_id: string;
    version: number;
    task_text: string;
    start_path: string;
    goal: { type: string; target: string };
    intended_path: string[];
    milestones: unknown[];
  };
  snapshot: { snapshot_id: string; data_cutoff_at: string; metrics: Record<string, number | null> };
  sessions: {
    session_id: string;
    outcome: string;
    final_reason: string | null;
    duration_s: number | null;
    data_quality_flag: string | null;
    events: { event_id: string; seq: number | null; name: string; route: string | null; element_key: string | null; element_label: string | null; t_ms: number }[];
    feedback: { response_id: string; slot: string; displayed_question: string; answer_text: string | null; choice: string | null }[];
  }[];
}

export interface AnalysisResult {
  /** AgenticOrg correlation_id — the key that links the run to its HITL approval. */
  externalRunId: string;
  runId: string | null;
  status: "draft_ready" | "failed";
  output?: unknown;
  hitlTriggered: boolean;
  confidence: number | null;
  error?: string;
}

export type ApprovalDecision = "approved" | "rejected" | "pending" | "expired";

export interface ApprovalRecord {
  approvalId: string;
  decision: ApprovalDecision;
  reviewer: string | null;
  decidedAt: string | null;
}

export interface UxDirectorProvider {
  readonly name: "agenticorg";
  readonly configured: boolean;
  /** True once a live implementation exists. */
  readonly implemented: boolean;
  /** True when approval decisions can be read back from AgenticOrg. */
  readonly approvalsConfigured: boolean;
  missingKeys(): string[];
  generateContextualQuestion(summary: SessionSummaryForQuestion, opts: { timeoutMs: number }): Promise<ContextualQuestion | null>;
  runAnalysis(pkg: EvidencePackage, opts: { jobId: string; timeoutMs?: number }): Promise<AnalysisResult>;
  /** Finds the AgenticOrg HITL approval created by a report run. */
  findApprovalForRun(externalRunId: string): Promise<ApprovalRecord | null>;
  /** Confirms an approval decision recorded in AgenticOrg's own HITL system. */
  getApproval(approvalId: string): Promise<{ approvalId: string; decision: "approved" | "rejected" | "pending"; reviewer: string | null }>;
  healthCheck(): Promise<HealthResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
  }
}

export class AgenticOrgRunError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface RunResponse {
  run_id?: string;
  correlation_id?: string;
  status?: string;
  output?: unknown;
  confidence?: number;
  hitl_trigger?: string | null;
  error?: string | null;
}

type AdapterConfig = Pick<
  AppConfig,
  | "AGENTICORG_BASE_URL"
  | "AGENTICORG_API_KEY"
  | "AGENTICORG_Q2_AGENT_ID"
  | "AGENTICORG_REPORT_AGENT_ID"
  | "AGENTICORG_APPROVALS_API_KEY"
>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Decodes a Python string literal body (between the quotes). */
function decodePythonString(body: string): string {
  return body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/gs, (_m, esc: string) => {
    switch (esc[0]) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "x":
      case "u":
      case "U":
        return String.fromCodePoint(parseInt(esc.slice(1), 16));
      default:
        return esc;
    }
  });
}

/** Extracts the text of every {'type': 'text', 'text': '...'} block in a Python repr. */
function textFromPythonRepr(repr: string): string | null {
  const parts: string[] = [];
  const re = /'text':\s*(['"])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(repr))) {
    const quote = m[1]!;
    let i = re.lastIndex;
    let body = "";
    while (i < repr.length) {
      const ch = repr[i]!;
      if (ch === "\\") {
        body += ch + (repr[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (ch === quote) break;
      body += ch;
      i++;
    }
    parts.push(decodePythonString(body));
    re.lastIndex = i + 1;
  }
  return parts.length ? parts.join("") : null;
}

/** Returns the first balanced JSON object in a string. */
function firstJsonObject(text: string): unknown {
  const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON object in agent output");
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("unbalanced JSON object in agent output");
}

/** Normalizes both observed `output` shapes into the agent's JSON object. */
export function parseAgentOutput(output: unknown): unknown {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const o = output as Record<string, unknown>;
    if (!("raw_output" in o)) return o;
    const raw = o.raw_output;
    if (raw && typeof raw === "object") return raw;
    if (typeof raw !== "string" || raw.trim() === "") throw new Error("empty agent output");
    const trimmed = raw.trim();
    const fromRepr = /^[[{]\s*'type'\s*:/.test(trimmed) ? textFromPythonRepr(trimmed) : null;
    return firstJsonObject(fromRepr ?? trimmed);
  }
  if (typeof output === "string") return firstJsonObject(output);
  throw new Error("unrecognized agent output");
}

function mapDecision(item: Record<string, unknown>): ApprovalDecision {
  const decision = String(item.decision ?? "").toLowerCase();
  const status = String(item.status ?? "").toLowerCase();
  if (decision === "approve" && (status === "decided" || status === "approved")) return "approved";
  // "override" replaces the agent output with a human one — never treated as approval of the draft.
  if (decision === "reject" || decision === "override" || status === "rejected") return "rejected";
  const expires = typeof item.expires_at === "string" ? Date.parse(item.expires_at) : NaN;
  if (status === "expired" || (!decision && !Number.isNaN(expires) && expires <= Date.now())) return "expired";
  return "pending";
}

export class AgenticOrgAdapter implements UxDirectorProvider {
  readonly name = "agenticorg" as const;
  readonly implemented = true;

  constructor(
    private readonly config: AdapterConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return this.missingKeys().length === 0;
  }

  get approvalsConfigured(): boolean {
    return this.configured && Boolean(this.config.AGENTICORG_APPROVALS_API_KEY);
  }

  missingKeys(): string[] {
    const keys: [string, unknown][] = [
      ["AGENTICORG_BASE_URL", this.config.AGENTICORG_BASE_URL],
      ["AGENTICORG_API_KEY", this.config.AGENTICORG_API_KEY],
      ["AGENTICORG_Q2_AGENT_ID", this.config.AGENTICORG_Q2_AGENT_ID],
      ["AGENTICORG_REPORT_AGENT_ID", this.config.AGENTICORG_REPORT_AGENT_ID],
    ];
    return keys.filter(([, v]) => !v).map(([k]) => k);
  }

  private base(): string {
    return this.config.AGENTICORG_BASE_URL!.replace(/\/+$/, "");
  }

  private requireConfigured(): void {
    if (!this.configured) throw new ProviderUnavailableError("agenticorg", "The UX Director (AgenticOrg) isn't connected.");
  }

  /** POST /api/v1/agents/{id}/run. Retries 429 (shared tenant rate limit) while the deadline allows. */
  async runAgent(agentId: string, inputs: Record<string, unknown>, context: Record<string, unknown>, timeoutMs: number): Promise<RunResponse> {
    this.requireConfigured();
    const deadline = Date.now() + timeoutMs;
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new AgenticOrgRunError("AgenticOrg run timed out", 504);
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.base()}/api/v1/agents/${encodeURIComponent(agentId)}/run`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.config.AGENTICORG_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process", inputs, context }),
          signal: AbortSignal.timeout(remaining),
        });
      } catch (err) {
        const name = (err as Error).name;
        throw new AgenticOrgRunError(name === "TimeoutError" || name === "AbortError" ? "AgenticOrg run timed out" : "AgenticOrg is unreachable", 504);
      }
      if (res.status === 429 && attempt < 3) {
        const wait = Math.min(2000 * 2 ** attempt, deadline - Date.now() - 500);
        if (wait > 0) {
          await sleep(wait);
          continue;
        }
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 200);
        throw new AgenticOrgRunError(`AgenticOrg run failed (HTTP ${res.status})${text ? `: ${text}` : ""}`, res.status);
      }
      return (await res.json()) as RunResponse;
    }
  }

  async generateContextualQuestion(summary: SessionSummaryForQuestion, opts: { timeoutMs: number }): Promise<ContextualQuestion | null> {
    if (!this.configured) return null;
    const run = await this.runAgent(
      this.config.AGENTICORG_Q2_AGENT_ID!,
      {
        query: "Write the contextual follow-up question for this attempt.",
        payload: { task_text: summary.task, goal: summary.goal, outcome: summary.outcome, events: summary.events },
      },
      { ff_session_id: summary.sessionPublicId },
      opts.timeoutMs,
    );
    if (run.status === "failed" || !run.correlation_id) return null;
    const out = parseAgentOutput(run.output) as { question?: unknown; evidence_event_id?: unknown };
    const question = typeof out.question === "string" ? out.question.trim() : "";
    if (!question || question.length > 300) return null;
    const ids = new Set(summary.events.map((e) => e.event_id));
    const evidence = typeof out.evidence_event_id === "string" && ids.has(out.evidence_event_id) ? out.evidence_event_id : null;
    return { question, evidenceEventId: evidence, externalRunId: run.correlation_id, hitlTriggered: run.status === "hitl_triggered" };
  }

  async runAnalysis(pkg: EvidencePackage, opts: { jobId: string; timeoutMs?: number }): Promise<AnalysisResult> {
    this.requireConfigured();
    const run = await this.runAgent(
      this.config.AGENTICORG_REPORT_AGENT_ID!,
      { query: "Draft the usability report for this study snapshot.", payload: pkg },
      { ff_job_id: opts.jobId, ff_study_id: pkg.study.study_id, ff_snapshot_id: pkg.snapshot.snapshot_id },
      opts.timeoutMs ?? 150_000,
    );
    const base = {
      externalRunId: run.correlation_id ?? run.run_id ?? "",
      runId: run.run_id ?? null,
      hitlTriggered: run.status === "hitl_triggered",
      confidence: typeof run.confidence === "number" ? run.confidence : null,
    };
    if (!base.externalRunId) return { ...base, status: "failed", error: "AgenticOrg returned no run reference" };
    if (run.status === "failed") return { ...base, status: "failed", error: run.error ?? "Agent execution failed" };
    try {
      return { ...base, status: "draft_ready", output: parseAgentOutput(run.output) };
    } catch (err) {
      return { ...base, status: "failed", error: (err as Error).message };
    }
  }

  private async listApprovals(): Promise<Record<string, unknown>[]> {
    if (!this.approvalsConfigured) {
      throw new ProviderUnavailableError("agenticorg", "AgenticOrg approvals can't be read: AGENTICORG_APPROVALS_API_KEY isn't set.");
    }
    const items: Record<string, unknown>[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await this.fetchImpl(`${this.base()}/api/v1/approvals?per_page=100&page=${page}&include_expired=true`, {
        headers: { Authorization: `Bearer ${this.config.AGENTICORG_APPROVALS_API_KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new AgenticOrgRunError(`Reading AgenticOrg approvals failed (HTTP ${res.status})`, res.status);
      const body = (await res.json()) as { items?: Record<string, unknown>[]; total?: number };
      const batch = body.items ?? [];
      items.push(...batch);
      if (batch.length < 100 || (typeof body.total === "number" && items.length >= body.total)) break;
    }
    return items;
  }

  private toRecord(item: Record<string, unknown>): ApprovalRecord {
    return {
      approvalId: String(item.id),
      decision: mapDecision(item),
      reviewer: typeof item.decision_by === "string" ? item.decision_by : null,
      decidedAt: typeof item.decision_at === "string" ? item.decision_at : null,
    };
  }

  async findApprovalForRun(externalRunId: string): Promise<ApprovalRecord | null> {
    const items = await this.listApprovals();
    const match = items.find((i) => (i.context as Record<string, unknown> | undefined)?.correlation_id === externalRunId);
    return match ? this.toRecord(match) : null;
  }

  async getApproval(approvalId: string): Promise<{ approvalId: string; decision: "approved" | "rejected" | "pending"; reviewer: string | null }> {
    if (!approvalId) throw new ProviderUnavailableError("agenticorg", "No AgenticOrg approval is linked to this report.");
    const items = await this.listApprovals();
    const match = items.find((i) => i.id === approvalId);
    if (!match) return { approvalId, decision: "pending", reviewer: null };
    const r = this.toRecord(match);
    return { approvalId, decision: r.decision === "expired" ? "rejected" : r.decision, reviewer: r.reviewer };
  }

  /** Real check: one contextual-question run on a tiny synthetic attempt (no participant data). */
  async healthCheck(): Promise<HealthResult> {
    if (!this.configured) {
      return { ok: false, status: "not_configured", message: `Missing: ${this.missingKeys().join(", ")}` };
    }
    try {
      const q = await this.generateContextualQuestion(
        {
          sessionPublicId: "ffx_healthcheck",
          task: "Create an account and reach your dashboard",
          goal: { type: "page_reached", target: "/dashboard" },
          outcome: "completed",
          events: [
            { event_id: "evt_hc_1", seq: 1, name: "ff_page_viewed", route: "/", element_key: null, element_type: null, element_label: null, t_ms_from_start: 0 },
            { event_id: "evt_hc_2", seq: 2, name: "ff_page_viewed", route: "/pricing", element_key: null, element_type: null, element_label: null, t_ms_from_start: 4000 },
            { event_id: "evt_hc_3", seq: 3, name: "ff_page_viewed", route: "/signup", element_key: null, element_type: null, element_label: null, t_ms_from_start: 20000 },
            { event_id: "evt_hc_4", seq: 4, name: "ff_page_viewed", route: "/dashboard", element_key: null, element_type: null, element_label: null, t_ms_from_start: 45000 },
          ],
        },
        { timeoutMs: 30_000 },
      );
      if (!q) return { ok: false, status: "error", message: "The contextual-question agent ran but returned no usable question." };
      const approvals = this.config.AGENTICORG_APPROVALS_API_KEY
        ? await this.listApprovals().then(
            () => "readable",
            (err: Error) => `error: ${err.message}`,
          )
        : "not configured (publishing stays blocked)";
      return {
        ok: true,
        status: "verified",
        message: `Contextual-question agent run ${q.externalRunId} succeeded. Approvals: ${approvals}.`,
        details: { externalRunId: q.externalRunId, approvals },
      };
    } catch (err) {
      return { ok: false, status: "error", message: (err as Error).message };
    }
  }
}
