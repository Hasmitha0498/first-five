import { describe, expect, it, vi } from "vitest";
import { AgenticOrgAdapter, parseAgentOutput } from "../../apps/server/src/integrations/agenticorg";
import { PineLabsAdapter } from "../../apps/server/src/integrations/pinelabs";
import { mapToPostHogEvent, PostHogAdapter } from "../../apps/server/src/integrations/posthog";
import { validateResearchOutput } from "../../apps/server/src/services/research-output";
import { loadConfig } from "../../apps/server/src/config";

const event = {
  eventId: "6f1c0d8e-1111-4c4c-9b9b-000000000001",
  eventName: "ff_element_clicked",
  distinctId: "p_participant17",
  timestamp: "2026-10-24T09:00:00.000Z",
  projectPublicId: "ffp_123",
  studyPublicId: "ffs_456",
  sessionPublicId: "ffx_789",
  mode: "live" as const,
  clientSequence: 17,
  pagePath: "/signup",
  elementKey: "create_account",
  elementType: "button",
  elementLabel: "Create Account",
  customEventName: null,
};

describe("PostHog adapter", () => {
  it("maps to PostHog capture format without overwriting $session_id", () => {
    const e = mapToPostHogEvent(event);
    expect(e.event).toBe("ff_element_clicked");
    expect(e.distinct_id).toBe("p_participant17");
    expect(e.uuid).toBe(event.eventId);
    expect(e.properties.ff_session_id).toBe("ffx_789");
    expect(e.properties).not.toHaveProperty("$session_id");
  });

  it("reports not configured without credentials and never calls the network", async () => {
    const fetchMock = vi.fn();
    const a = new PostHogAdapter({ POSTHOG_HOST: undefined, POSTHOG_API_HOST: undefined, POSTHOG_PROJECT_API_KEY: undefined, POSTHOG_PERSONAL_API_KEY: undefined, POSTHOG_PROJECT_ID: undefined }, fetchMock);
    expect(a.configured).toBe(false);
    expect((await a.verifyRoundTrip()).status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends batches to /batch/ with the project key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const a = new PostHogAdapter(
      { POSTHOG_HOST: "https://us.i.posthog.com", POSTHOG_API_HOST: undefined, POSTHOG_PROJECT_API_KEY: "phc_test", POSTHOG_PERSONAL_API_KEY: undefined, POSTHOG_PROJECT_ID: undefined },
      fetchMock as unknown as typeof fetch,
    );
    await a.captureBatch([mapToPostHogEvent(event)]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://us.i.posthog.com/batch/");
    const body = JSON.parse(init.body);
    expect(body.api_key).toBe("phc_test");
    expect(body.batch).toHaveLength(1);
    // Read-back verification isn't possible without query access → pending, not verified.
    expect((await a.verifyRoundTrip()).status).toBe("verification_pending");
  });
});

const q2Summary = {
  sessionPublicId: "ffx_1",
  task: "Create an account",
  goal: { type: "page_reached", target: "/dashboard" },
  outcome: "completed" as const,
  events: [{ event_id: "evt_1", seq: 1, name: "ff_page_viewed", route: "/pricing", element_key: null, element_type: null, element_label: null, t_ms_from_start: 0 }],
};
const aoConfig = {
  AGENTICORG_BASE_URL: "https://ao.example.com/",
  AGENTICORG_API_KEY: "ao_sk_test",
  AGENTICORG_Q2_AGENT_ID: "q2-agent",
  AGENTICORG_REPORT_AGENT_ID: "report-agent",
  AGENTICORG_APPROVALS_API_KEY: undefined as string | undefined,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("AgenticOrg adapter", () => {
  it("parses both observed output shapes", () => {
    expect(parseAgentOutput({ question: "Q?", evidence_event_id: "evt_1" })).toEqual({ question: "Q?", evidence_event_id: "evt_1" });
    const repr = `{'type': 'text', 'text': '{"study_id":"ffs_1","note":"it\\'s fine"}'}`;
    expect(parseAgentOutput({ raw_output: repr, status: "completed" })).toEqual({ study_id: "ffs_1", note: "it's fine" });
    expect(parseAgentOutput({ raw_output: '```json\n{"a":1}\n```' })).toEqual({ a: 1 });
    expect(() => parseAgentOutput({ raw_output: "" })).toThrow(/empty/);
  });

  it("runs the Q2 agent by ID with a JSON body and returns the correlation id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({ run_id: "msg_1", correlation_id: "run_1", status: "hitl_triggered", output: { question: "You opened pricing twice. What were you looking for?", evidence_event_id: "evt_1" }, confidence: 0.77 }),
    );
    const ux = new AgenticOrgAdapter(aoConfig, fetchMock as unknown as typeof fetch);
    const q = await ux.generateContextualQuestion(q2Summary, { timeoutMs: 5000 });
    expect(q).toEqual({ question: "You opened pricing twice. What were you looking for?", evidenceEventId: "evt_1", externalRunId: "run_1", hitlTriggered: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ao.example.com/api/v1/agents/q2-agent/run");
    expect(init.headers).toMatchObject({ Authorization: "Bearer ao_sk_test", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toMatchObject({ action: "process", inputs: { payload: { events: q2Summary.events } } });
  });

  it("drops evidence IDs the agent invented and retries the shared rate limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ detail: "Tenant LLM inference rate limit exceeded." }, 429))
      .mockResolvedValueOnce(json({ correlation_id: "run_2", status: "completed", output: { question: "What did you expect?", evidence_event_id: "evt_999" } }));
    const ux = new AgenticOrgAdapter(aoConfig, fetchMock as unknown as typeof fetch);
    const q = await ux.generateContextualQuestion(q2Summary, { timeoutMs: 10_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(q?.evidenceEventId).toBeNull();
  });

  it("reports failed report runs without fabricating output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ run_id: "msg_3", correlation_id: "run_3", status: "failed", output: { raw_output: "" }, error: "OpenAIInvalidRequestError" }));
    const ux = new AgenticOrgAdapter(aoConfig, fetchMock as unknown as typeof fetch);
    const r = await ux.runAnalysis({ study: { study_id: "ffs_1" }, snapshot: { snapshot_id: "snap_1" }, sessions: [] } as never, { jobId: "job_1" });
    expect(r).toMatchObject({ status: "failed", externalRunId: "run_3", error: "OpenAIInvalidRequestError" });
    expect(r.output).toBeUndefined();
  });

  it("matches the HITL approval by correlation id and needs an approvals key", async () => {
    const noKey = new AgenticOrgAdapter(aoConfig, vi.fn() as unknown as typeof fetch);
    expect(noKey.approvalsConfigured).toBe(false);
    await expect(noKey.findApprovalForRun("run_1")).rejects.toThrow(/AGENTICORG_APPROVALS_API_KEY/);

    const fetchMock = vi.fn().mockImplementation(async () =>
      json({
        total: 3,
        items: [
          { id: "ap_1", status: "pending", decision: null, context: { correlation_id: "run_other" }, expires_at: "2999-01-01T00:00:00Z" },
          { id: "ap_2", status: "decided", decision: "approve", decision_by: "user_1", decision_at: "2026-10-24T12:00:00Z", context: { correlation_id: "run_1" } },
          { id: "ap_3", status: "decided", decision: "override", context: { correlation_id: "run_x" } },
        ],
      }),
    );
    const ux = new AgenticOrgAdapter({ ...aoConfig, AGENTICORG_APPROVALS_API_KEY: "ao_sk_approvals" }, fetchMock as unknown as typeof fetch);
    expect(await ux.findApprovalForRun("run_1")).toEqual({ approvalId: "ap_2", decision: "approved", reviewer: "user_1", decidedAt: "2026-10-24T12:00:00Z" });
    expect((await ux.findApprovalForRun("run_x"))?.decision).toBe("rejected");
    expect(await ux.findApprovalForRun("run_none")).toBeNull();
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer ao_sk_approvals");
  });
});

describe("AgenticOrg and Pine Labs adapters", () => {
  it("are not configured and never fabricate results", async () => {
    const fetchMock = vi.fn();
    const ux = new AgenticOrgAdapter(
      { AGENTICORG_BASE_URL: undefined, AGENTICORG_API_KEY: undefined, AGENTICORG_Q2_AGENT_ID: undefined, AGENTICORG_REPORT_AGENT_ID: undefined, AGENTICORG_APPROVALS_API_KEY: undefined },
      fetchMock as unknown as typeof fetch,
    );
    expect(ux.configured).toBe(false);
    expect(await ux.generateContextualQuestion(q2Summary, { timeoutMs: 1000 })).toBeNull();
    await expect(ux.runAnalysis({} as never, { jobId: "x" })).rejects.toThrow(/isn't connected/);
    expect((await ux.healthCheck()).status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
    const pay = new PineLabsAdapter({ PINELABS_ENV: "uat", PINELABS_BASE_URL: undefined, PINELABS_CLIENT_ID: undefined, PINELABS_CLIENT_SECRET: undefined, PINELABS_MERCHANT_ID: undefined, PINELABS_WEBHOOK_SECRET: undefined });
    expect(pay.configured).toBe(false);
    expect((await pay.verifyWebhook()).valid).toBe(false);
    await expect(pay.createCheckout()).rejects.toThrow(/isn't available/);
  });
});

describe("UX Director output validation", () => {
  const scope = {
    studyPublicId: "ffs_456",
    sessionPublicIds: new Set(["ffx_1", "ffx_2"]),
    eventIdsBySession: new Map([["ffx_1", new Set(["evt_1"])]]),
    responseIdsBySession: new Map([["ffx_1", new Set(["resp_1"])]]),
  };
  const output = (over: Record<string, unknown> = {}) => ({
    study_id: "ffs_456",
    snapshot_id: "snap_1",
    individual_findings: [
      { session_id: "ffx_1", observed: ["Visited pricing"], reported: ["Wanted price"], hypotheses: [], evidence_event_ids: ["evt_1"], feedback_response_ids: ["resp_1"], limitations: [] },
    ],
    aggregate_findings: [
      { issue: "Pricing", affected_session_ids: ["ffx_1"], affected_count_from_backend: 1, evidence_strength: "limited", counterexamples: ["ffx_2"], recommendation: "x", success_measure: "y" },
    ],
    approval_status: "pending",
    ...over,
  });
  it("accepts output whose evidence is in scope", () => {
    expect(validateResearchOutput(output(), scope).ok).toBe(true);
  });
  it("rejects fabricated sessions, events and counts", () => {
    const bad = output({
      individual_findings: [{ session_id: "ffx_9", observed: [], reported: [], hypotheses: [], evidence_event_ids: ["evt_x"], feedback_response_ids: [], limitations: [] }],
      aggregate_findings: [{ issue: "Pricing", affected_session_ids: ["ffx_1"], affected_count_from_backend: 4, evidence_strength: "supported", counterexamples: [], recommendation: "x", success_measure: "y" }],
    });
    const r = validateResearchOutput(bad, scope);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/unknown session ffx_9/);
      expect(r.errors.join("\n")).toMatch(/affected count 4/);
    }
  });
  it("fills a null count from the backend", () => {
    const r = validateResearchOutput(
      output({ aggregate_findings: [{ issue: "Pricing", affected_session_ids: ["ffx_1", "ffx_1"], affected_count_from_backend: null, evidence_strength: "limited", counterexamples: [], recommendation: "x", success_measure: "y" }] }),
      scope,
    );
    expect(r.ok && r.output.aggregate_findings[0]!.affected_count_from_backend).toBe(1);
  });
  it("rejects non-verbatim quotes, percentages and contradictory evidence", () => {
    const withAnswers = { ...scope, answerTextByResponse: new Map([["resp_1", "I wanted to see the price first."]]) };
    expect(validateResearchOutput(output({ individual_findings: [{ ...output().individual_findings[0]!, reported: ["“I wanted to see the price first”"] }] }), withAnswers).ok).toBe(true);
    const bad = validateResearchOutput(
      output({
        individual_findings: [{ ...output().individual_findings[0]!, reported: ["The price was too high"] }],
        aggregate_findings: [{ issue: "Pricing", affected_session_ids: ["ffx_1"], affected_count_from_backend: null, evidence_strength: "limited", counterexamples: ["ffx_1"], recommendation: "Affects 60% of users", success_measure: "y" }],
      }),
      withAnswers,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const all = bad.errors.join("\n");
      expect(all).toMatch(/not a verbatim participant answer/);
      expect(all).toMatch(/percentage/);
      expect(all).toMatch(/both support and contradict/);
    }
  });
});

describe("configuration", () => {
  it("requires https and a long secret in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "x".repeat(40), APP_URL: "http://x.com" })).toThrow(/https/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://x", SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
    const c = loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "x".repeat(40), RENDER_EXTERNAL_URL: "https://first-five.onrender.com" });
    expect(c.appUrl).toBe("https://first-five.onrender.com");
    expect(c.secureCookies).toBe(true);
  });
});
