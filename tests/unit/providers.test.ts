import { describe, expect, it, vi } from "vitest";
import { AgenticOrgAdapter } from "../../apps/server/src/integrations/agenticorg";
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

describe("AgenticOrg and Pine Labs adapters", () => {
  it("are not configured and never fabricate results", async () => {
    const ux = new AgenticOrgAdapter({ AGENTICORG_BASE_URL: undefined, AGENTICORG_API_KEY: undefined, AGENTICORG_WORKFLOW_ID: undefined });
    expect(ux.configured).toBe(false);
    expect(await ux.generateContextualQuestion()).toBeNull();
    await expect(ux.startAnalysis()).rejects.toThrow(/isn't connected/);
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
