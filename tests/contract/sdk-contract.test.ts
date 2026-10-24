/**
 * SDK ⇄ Render CONTRACT TESTS.
 *
 * These requests are hand-built fixtures that follow docs/integrations/SDK_INTEGRATION.md.
 * They verify the Render backend honours the contract. They are NOT proof that the
 * separately developed SDK works end-to-end. The SDK team can run this suite (or port
 * it) against a deployed backend to check compatibility.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectedProject,
  createHarness,
  json,
  launchedStudy,
  resetDb,
  SITE,
  sdkEvent,
  sdkEvents,
  sdkExchange,
  signup,
  signupWithAccess,
  startParticipant,
  type Harness,
} from "../setup/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await resetDb(h.db);
});
afterAll(async () => h.close());

describe("GET /api/sdk/config", () => {
  it("returns non-secret config, CORS for registered origins, and records an installation ping", async () => {
    const { client } = await signupWithAccess(h);
    const p = json(await client.post("/api/projects", { name: "Cfg", websiteUrl: SITE }));
    const res = await h.app.inject({ url: `/api/sdk/config?project_id=${p.publicId}&sdk_version=1.0.0`, headers: { origin: SITE } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(SITE);
    const body = json(res);
    expect(body).toMatchObject({ project_id: p.publicId, contract_version: 1, allowed_origins: [SITE] });
    expect(JSON.stringify(body)).not.toMatch(/secret|password|api_key/i);
    const after = json(await client.get(`/api/projects/${p.id}`));
    expect(after.integrationStatus).toBe("verification_needed");
    expect(after.lastSdkVersion).toBe("1.0.0");
  });

  it("refuses unregistered origins and surfaces a connection issue (A03)", async () => {
    const { client } = await signupWithAccess(h);
    const p = json(await client.post("/api/projects", { name: "Cfg2", websiteUrl: "https://right.example.com" }));
    const res = await h.app.inject({ url: `/api/sdk/config?project_id=${p.publicId}`, headers: { origin: "https://wrong.example.com" } });
    expect(res.statusCode).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(json(await client.get(`/api/projects/${p.id}`)).integrationStatus).toBe("connection_issue");
  });

  it("answers CORS preflight only for registered origins", async () => {
    const ok = await h.app.inject({ method: "OPTIONS", url: "/api/sdk/events", headers: { origin: SITE, "access-control-request-method": "POST" } });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers["access-control-allow-headers"]).toContain("authorization");
    const bad = await h.app.inject({ method: "OPTIONS", url: "/api/sdk/events", headers: { origin: "https://nope.example.com" } });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("setup walkthrough", () => {
  it("exchanges a one-time setup ticket and builds the discovery catalog (A02, A04, A05)", async () => {
    const { client } = await signupWithAccess(h);
    const p = json(await client.post("/api/projects", { name: "Setup", websiteUrl: SITE }));
    const setup = json(await client.post(`/api/projects/${p.id}/setup-sessions`));
    expect(setup.launchUrl).toMatch(/#ff_setup=/);

    expect((await sdkExchange(h.app, p.publicId, setup.launchUrl, "https://evil.example.com")).statusCode).toBe(403);
    const ex = await sdkExchange(h.app, p.publicId, setup.launchUrl);
    expect(ex.statusCode).toBe(200);
    expect(json(ex)).toMatchObject({ mode: "setup", project_id: p.publicId });
    const again = await sdkExchange(h.app, p.publicId, setup.launchUrl);
    expect(again.statusCode).toBe(410);
    expect(json(again).error.code).toBe("ticket_consumed");

    const cred = json(ex).credential;
    const base = { project_id: p.publicId, mode: "setup" as const };
    const res = await sdkEvents(h.app, cred, [
      sdkEvent(base, 0, { event_name: "ff_page_viewed", page_path: "/" }),
      sdkEvent(base, 1, { event_name: "ff_page_viewed", page_path: "/signup?email=jane@example.com" }),
      sdkEvent(base, 2, { event_name: "ff_element_discovered", page_path: "/signup", element_id: "create-account", element_type: "button", element_label: "Create account" }),
      sdkEvent(base, 3, { event_name: "ff_element_discovered", page_path: "/signup", element_id: "pricing-link", element_type: "link", element_label: "Pricing" }),
      sdkEvent(base, 4, { event_name: "ff_element_clicked", page_path: "/signup", element_id: "create-account", element_type: "button", element_label: "Create account" }),
      sdkEvent(base, 5, { event_name: "ff_custom_event", page_path: "/dashboard", custom_event_name: "signup_completed" }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(json(res).accepted).toHaveLength(6);

    const d = json(await client.get(`/api/projects/${p.id}/discovery`));
    expect(d.integrationStatus).toBe("connected");
    expect(d.pages.map((x: { path: string }) => x.path).sort()).toEqual(["/", "/dashboard", "/signup"].sort());
    const els = Object.fromEntries(d.elements.map((e: { elementKey: string; wasClicked: boolean }) => [e.elementKey, e.wasClicked]));
    expect(els).toEqual({ "create-account": true, "pricing-link": false });
    expect(d.customEvents.map((c: { eventName: string }) => c.eventName)).toEqual(["signup_completed"]);
    // Query string with PII was stripped.
    expect(JSON.stringify(d)).not.toContain("jane@example.com");
  });

  it("validates events and acknowledges duplicates without double counting (A12)", async () => {
    const { client } = await signupWithAccess(h);
    const { project, setupCredential } = await connectedProject(h.app, client, { pages: ["/"] , elements: [] });
    const base = { project_id: project.publicId, mode: "setup" as const };
    const e1 = sdkEvent(base, 10, { event_name: "ff_page_viewed", page_path: "/again" });
    const res = await sdkEvents(h.app, setupCredential, [
      e1,
      e1,
      sdkEvent(base, 11, { event_name: "ff_page_viewed", page_path: "/x", properties: { password: "hunter2" } }),
      sdkEvent({ ...base, session_id: "ffx_abcdefgh12345678" }, 12, { event_name: "ff_page_viewed", page_path: "/y" }),
      sdkEvent({ ...base, project_id: "ffp_someoneelse12345" }, 13, { event_name: "ff_page_viewed", page_path: "/z" }),
      sdkEvent(base, 14, { event_name: "ff_page_viewed", page_path: "/future", timestamp: new Date(Date.now() + 3600_000).toISOString() }),
      { not: "an event" },
    ]);
    const body = json(res);
    expect(body.accepted).toEqual([e1.event_id]);
    expect(body.duplicates).toEqual([e1.event_id]);
    const codes = body.rejected.map((r: { code: string }) => r.code).sort();
    expect(codes).toEqual(["clock_skew", "invalid_schema", "invalid_schema", "wrong_mode", "wrong_project"].sort());
    const retry = json(await sdkEvents(h.app, setupCredential, [e1]));
    expect(retry.duplicates).toEqual([e1.event_id]);
    expect(await h.db.eventRecord.count({ where: { eventId: e1.event_id } })).toBe(1);
  });

  it("requires a credential and rejects oversized batches", async () => {
    const noAuth = await h.app.inject({ method: "POST", url: "/api/sdk/events", headers: { origin: SITE }, payload: { schema_version: 1, events: [{}] } });
    expect(noAuth.statusCode).toBe(401);
    const huge = await h.app.inject({
      method: "POST",
      url: "/api/sdk/events",
      headers: { origin: SITE, authorization: "Bearer x", "content-type": "application/json" },
      payload: JSON.stringify({ schema_version: 1, events: [{ pad: "x".repeat(70_000) }] }),
    });
    expect(huge.statusCode).toBe(413);
  });
});

describe("live task handoff", () => {
  it("exchanges a launch ticket, verifies the goal once, and hands off to feedback (A07, A09)", async () => {
    const { client } = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, client);
    const study = await launchedStudy(h.app, client, project.id);
    const { attempt } = await startParticipant(h.app, study.publicId);
    expect(attempt.launchUrl).toMatch(new RegExp(`^${SITE}/signup#ff_launch=`));

    const ex = await sdkExchange(h.app, project.publicId, attempt.launchUrl);
    expect(ex.statusCode).toBe(200);
    const live = json(ex);
    expect(live.mode).toBe("live");
    expect(live.study).toMatchObject({ study_id: study.publicId, session_id: attempt.sessionId, goal_type: "page_reached" });

    // Session recovery after a refresh (A08)
    const state = json(await h.app.inject({ url: "/api/sdk/session", headers: { origin: SITE, authorization: `Bearer ${live.credential}` } }));
    expect(state.study).toMatchObject({ status: "pending", goal_verified: false });

    const base = { project_id: project.publicId, mode: "live" as const, study_id: study.publicId, session_id: attempt.sessionId };
    const setupOnly = sdkEvent(base, 0, { event_name: "ff_element_discovered", page_path: "/signup", element_id: "x" });
    const hint = sdkEvent(base, 1, { event_name: "ff_goal_reached", page_path: "/signup" });
    const r1 = json(await sdkEvents(h.app, live.credential, [setupOnly, hint, sdkEvent(base, 2, { event_name: "ff_page_viewed", page_path: "/signup" })]));
    expect(r1.rejected.map((r: { code: string }) => r.code)).toEqual(["setup_only_event"]);
    expect(r1.goal).toEqual({ verified: false, verified_event_id: null }); // SDK hint alone never completes

    const goal = sdkEvent(base, 3, { event_name: "ff_page_viewed", page_path: "/dashboard/" });
    const r2 = json(await sdkEvents(h.app, live.credential, [goal]));
    expect(r2.goal).toEqual({ verified: true, verified_event_id: goal.event_id });
    expect(r2.session_status).toBe("completed");
    const r3 = json(await sdkEvents(h.app, live.credential, [sdkEvent(base, 4, { event_name: "ff_page_viewed", page_path: "/dashboard" })]));
    expect(r3.goal.verified_event_id).toBe(goal.event_id);
    expect(await h.db.criticalEventReceipt.count({ where: { kind: "goal_verified" } })).toBe(1);

    const end = await h.app.inject({ method: "POST", url: "/api/sdk/session/end", headers: { origin: SITE, authorization: `Bearer ${live.credential}` }, payload: { reason: "finished" } });
    expect(end.statusCode).toBe(200);
    const endBody = json(end);
    expect(endBody.session_status).toBe("completed");
    expect(endBody.feedback_url).toMatch(new RegExp(`/t/${study.publicId}/feedback#h=`));
    // Credential is revoked after ending.
    const after = await sdkEvents(h.app, live.credential, [sdkEvent(base, 5, { event_name: "ff_page_viewed", page_path: "/" })]);
    expect(after.statusCode).toBe(410);
  });

  it("rejects live tickets on the wrong origin and project IDs without a ticket (A03)", async () => {
    const { client } = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, client);
    const study = await launchedStudy(h.app, client, project.id);
    const { attempt } = await startParticipant(h.app, study.publicId);
    expect((await sdkExchange(h.app, project.publicId, attempt.launchUrl, "https://evil.example.com")).statusCode).toBe(403);
    const fake = await h.app.inject({ method: "POST", url: "/api/sdk/exchange", headers: { origin: SITE }, payload: { project_id: project.publicId, ticket: "x".repeat(43) } });
    expect(fake.statusCode).toBe(404);
  });
});
