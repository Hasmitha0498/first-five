import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateCodes } from "../../apps/server/src/services/access-codes";
import { endSession, reconcileExpired } from "../../apps/server/src/services/sessions";
import {
  Client,
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

async function complimentaryBuilder() {
  const { codes } = await generateCodes(h.ctx, { label: "t", audience: "internal", planKey: "complimentary", count: 1, maxRedemptions: 1 });
  return signup(h.app, { invitationCode: codes[0] });
}

async function liveSession(client: Client, studyOverrides: Record<string, unknown> = {}) {
  const { project } = await connectedProject(h.app, client);
  const study = await launchedStudy(h.app, client, project.id, studyOverrides);
  const p = await startParticipant(h.app, study.publicId);
  const ex = json(await sdkExchange(h.app, project.publicId, p.attempt.launchUrl));
  const base = { project_id: project.publicId, mode: "live" as const, study_id: study.publicId, session_id: p.attempt.sessionId };
  const session = await h.db.studySession.findUniqueOrThrow({ where: { publicId: p.attempt.sessionId } });
  return { project, study, ...p, credential: ex.credential as string, base, session };
}

describe("study configuration", () => {
  it("saves an unverified draft and blocks launch until the website is connected", async () => {
    const { client } = await signupWithAccess(h);
    const p = json(await client.post("/api/projects", { name: "Draft", websiteUrl: SITE }));
    const res = await client.post("/api/studies", {
      projectId: p.id,
      name: "Onboarding test",
      task: "Create an account and reach the dashboard.",
      startPath: "/signup",
      goalType: "page_reached",
      goalTarget: "/dashboard",
    });
    expect(res.statusCode).toBe(201);
    const s = json(res);
    expect(s.status).toBe("draft");
    expect(s.currentVersion).toMatchObject({ startVerified: false, goalVerified: false, timeLimitSeconds: 300 });
    expect(s.participantLimit).toBe(5);
    expect(s.readiness.canLaunch).toBe(false);
    expect(s.readiness.blockers.map((b: { code: string }) => b.code)).toEqual(expect.arrayContaining(["integration_not_connected", "start_unverified", "goal_unverified"]));
    const launch = await client.post(`/api/studies/${s.id}/launch`);
    expect(launch.statusCode).toBe(422);
    // Not reachable by participants.
    expect((await new Client(h.app).get(`/api/public/studies/${s.publicId}`)).statusCode).toBe(404);
  });

  it("validates ownership, goal format and participant limits", async () => {
    const a = await signupWithAccess(h);
    const b = await signupWithAccess(h);
    const p = json(await a.client.post("/api/projects", { name: "Own", websiteUrl: SITE }));
    expect((await b.client.post("/api/studies", { projectId: p.id, name: "x", task: "Do the thing", startPath: "/", goalType: "page_reached", goalTarget: "/done" })).statusCode).toBe(404);
    const badGoal = await a.client.post("/api/studies", { projectId: p.id, name: "x", task: "Do the thing", startPath: "/", goalType: "page_reached", goalTarget: "dashboard" });
    expect(badGoal.statusCode).toBe(400);
    const tooMany = await a.client.post("/api/studies", { projectId: p.id, name: "x", task: "Do the thing", startPath: "/", goalType: "page_reached", goalTarget: "/d", participantLimit: 50 });
    expect(tooMany.statusCode).toBe(400);
  });

  it("launches once start and goal are verified by discovery", async () => {
    const { client } = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, client);
    const study = await launchedStudy(h.app, client, project.id);
    expect(study.status).toBe("active");
    expect(study.currentVersion.publishedAt).toBeTruthy();
    expect(study.shareUrl).toBe(`http://localhost:3000/t/${study.publicId}`);
    const info = json(await new Client(h.app).get(`/api/public/studies/${study.publicId}`));
    expect(info).toMatchObject({ status: "open", task: "Create an account and reach the dashboard.", timeLimitSeconds: 300, existingAttempt: null });
  });
});

describe("study credits", () => {
  it("consumes one credit at first launch only, and blocks launches without credits", async () => {
    const { client } = await signupWithAccess(h, { studyCredits: 1 });
    const { project } = await connectedProject(h.app, client);
    const s1 = await launchedStudy(h.app, client, project.id);
    let me = json(await client.get("/api/auth/me")).entitlement;
    expect(me).toMatchObject({ studyCredits: 1, creditsUsed: 1, creditsAvailable: 0 });
    // Pause + resume does not consume another credit.
    await client.post(`/api/studies/${s1.id}/pause`);
    expect((await client.post(`/api/studies/${s1.id}/resume`)).statusCode).toBe(200);
    me = json(await client.get("/api/auth/me")).entitlement;
    expect(me.creditsUsed).toBe(1);
    // A second test can be drafted but not launched.
    const draft = json(
      await client.post("/api/studies", { projectId: project.id, name: "Second", task: "Find pricing.", startPath: "/", goalType: "page_reached", goalTarget: "/dashboard" }),
    );
    expect(draft.readiness.blockers.map((b: { code: string }) => b.code)).toContain("no_study_credits");
    const blocked = await client.post(`/api/studies/${draft.id}/launch`);
    expect(blocked.statusCode).toBe(422);
    // Existing work stays visible with no credits left.
    expect((await client.get(`/api/studies/${s1.id}/dashboard`)).statusCode).toBe(200);
  });

  it("cannot double-spend a single credit under concurrent launches", async () => {
    const { client } = await signupWithAccess(h, { studyCredits: 1 });
    const { project } = await connectedProject(h.app, client);
    const mk = async (name: string) =>
      json(await client.post("/api/studies", { projectId: project.id, name, task: "Reach the dashboard.", startPath: "/signup", goalType: "page_reached", goalTarget: "/dashboard" }));
    const a = await mk("A");
    const b = await mk("B");
    const results = await Promise.all([client.post(`/api/studies/${a.id}/launch`), client.post(`/api/studies/${b.id}/launch`)]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const grant = await h.db.accessGrant.findFirstOrThrow({ where: { user: { email: (json(await client.get("/api/auth/me")).user.email) } } });
    expect(grant.creditsUsed).toBe(1);
    expect(await h.db.study.count({ where: { creditGrantId: grant.id } })).toBe(1);
  });
});

describe("participant sessions", () => {
  it("requires consent before creating any attempt (A06)", async () => {
    const { client } = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, client);
    const study = await launchedStudy(h.app, client, project.id);
    const res = await new Client(h.app).post(`/api/public/studies/${study.publicId}/attempts`, { consent: false });
    expect(res.statusCode).toBe(400);
    expect(await h.db.studySession.count({ where: { study: { publicId: study.publicId } } })).toBe(0);
  });

  it("resumes the same attempt on refresh and enforces capacity", async () => {
    const { client } = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, client);
    const study = await launchedStudy(h.app, client, project.id, { participantLimit: 1 });
    const first = await startParticipant(h.app, study.publicId);
    expect(first.res.statusCode).toBe(201);
    const again = await first.participant.post(`/api/public/studies/${study.publicId}/attempts`, { consent: true });
    expect(json(again).sessionId).toBe(first.attempt.sessionId);
    const second = await startParticipant(h.app, study.publicId);
    expect(second.res.statusCode).toBe(410);
    expect(json(second.res).error.code).toBe("study_full");
    expect(json(await client.get(`/api/studies/${study.id}`)).status).toBe("full");
  });

  it("marks 'I'm stuck' as dropped with an explicit-stop reason (A10)", async () => {
    const { client } = await signupWithAccess(h);
    const s = await liveSession(client);
    const res = await s.participant.post(`/api/public/studies/${s.study.publicId}/attempt/end`, { reason: "gave_up" });
    const body = json(res);
    expect(body.status).toBe("dropped");
    expect(body.feedbackUrl).toMatch(/feedback#h=/);
    const row = await h.db.studySession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row.finalReason).toBe("explicit_stop");
    expect(row.feedbackStatus).toBe("awaiting");
  });

  it("finalizes at the deadline without any browser event (A11)", async () => {
    const { client } = await signupWithAccess(h);
    const s = await liveSession(client);
    await h.db.studySession.update({ where: { id: s.session.id }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
    const dash = json(await client.get(`/api/studies/${s.study.id}/dashboard`));
    expect(dash.metrics).toMatchObject({ dropped: 1, completed: 0, pending: 0, finalized: 1 });
    const row = await h.db.studySession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row).toMatchObject({ status: "dropped", finalReason: "deadline", feedbackStatus: "unavailable" });
  });

  it("classifies attempts whose website never connected as invalid, not dropped", async () => {
    const { client } = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, client);
    const study = await launchedStudy(h.app, client, project.id);
    const p = await startParticipant(h.app, study.publicId);
    await h.db.studySession.update({ where: { publicId: p.attempt.sessionId }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
    await reconcileExpired(h.ctx, { studyId: study.id });
    const row = await h.db.studySession.findUniqueOrThrow({ where: { publicId: p.attempt.sessionId } });
    expect(row).toMatchObject({ status: "invalid", finalReason: "launch_not_exchanged" });
    expect(row.dataQualityFlags).toContain("no_sdk_handshake");
    const m = json(await client.get(`/api/studies/${study.id}/dashboard`)).metrics;
    expect(m).toMatchObject({ attempts: 0, dropped: 0, invalid: 1 });
  });

  it("does not count a goal that occurred after the deadline", async () => {
    const { client } = await signupWithAccess(h);
    const s = await liveSession(client);
    // Inside the 15 s delivery grace window: stored for the timeline, not counted, flagged.
    await h.db.studySession.update({ where: { id: s.session.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
    const r = json(await sdkEvents(h.app, s.credential, [sdkEvent(s.base, 1, { event_name: "ff_page_viewed", page_path: "/dashboard" })]));
    expect(r.goal.verified).toBe(false);
    const row = await h.db.studySession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row.status).not.toBe("completed");
    expect(row.dataQualityFlags).toContain("late_goal_event");
  });

  it("rejects events from a task whose window closed long ago", async () => {
    const { client } = await signupWithAccess(h);
    const s = await liveSession(client);
    await h.db.studySession.update({ where: { id: s.session.id }, data: { deadlineAt: new Date(Date.now() - 120_000), startedAt: new Date(Date.now() - 420_000) } });
    await reconcileExpired(h.ctx, { sessionId: s.session.id });
    await h.db.studySession.update({ where: { id: s.session.id }, data: { finalizedAt: new Date(Date.now() - 100_000) } });
    const r = json(await sdkEvents(h.app, s.credential, [sdkEvent(s.base, 1, { event_name: "ff_page_viewed", page_path: "/dashboard" })]));
    expect(r.goal.verified).toBe(false);
    expect(r.rejected[0]?.code).toBe("session_finalized");
    expect(r.session_status).toBe("dropped");
  });

  it("lets exactly one of a concurrent goal and give-up win", async () => {
    const { client } = await signupWithAccess(h);
    const s = await liveSession(client);
    await Promise.all([
      sdkEvents(h.app, s.credential, [sdkEvent(s.base, 1, { event_name: "ff_page_viewed", page_path: "/dashboard" })]),
      endSession(h.ctx, s.session.id, "gave_up", "participant"),
    ]);
    const row = await h.db.studySession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(["completed", "dropped"]).toContain(row.status);
    const receipts = await h.db.criticalEventReceipt.count({ where: { studySessionId: s.session.id, kind: "goal_verified" } });
    expect(receipts).toBe(row.status === "completed" ? 1 : 0);
  });

  it("deletes activity and excludes the attempt when consent is withdrawn", async () => {
    const { client } = await signupWithAccess(h);
    const s = await liveSession(client);
    await sdkEvents(h.app, s.credential, [sdkEvent(s.base, 1, { event_name: "ff_page_viewed", page_path: "/signup" })]);
    expect(await h.db.eventRecord.count({ where: { studySessionId: s.session.id } })).toBe(1);
    const res = await s.participant.post(`/api/public/studies/${s.study.publicId}/attempt/end`, { reason: "consent_withdrawn" });
    expect(json(res).status).toBe("invalid");
    expect(await h.db.eventRecord.count({ where: { studySessionId: s.session.id } })).toBe(0);
  });

  it("flags repeat attempts and keeps them out of primary metrics", async () => {
    const { client } = await complimentaryBuilder();
    const s = await liveSession(client);
    await s.participant.post(`/api/public/studies/${s.study.publicId}/attempt/end`, { reason: "gave_up" });
    const again = json(await s.participant.post(`/api/public/studies/${s.study.publicId}/attempts`, { consent: true }));
    expect(again.isRepeat).toBe(true);
    const m = json(await client.get(`/api/studies/${s.study.id}/dashboard`)).metrics;
    expect(m.attempts).toBe(2 - 1);
    expect(m.repeatsExcluded).toBe(1);
  });

  it("locks the published definition and requires a new version to change it", async () => {
    const { client } = await signupWithAccess(h);
    const s = await liveSession(client);
    const locked = await client.patch(`/api/studies/${s.study.id}`, { goalTarget: "/welcome" });
    expect(locked.statusCode).toBe(409);
    expect(json(locked).error.code).toBe("version_locked");
    const nameOnly = await client.patch(`/api/studies/${s.study.id}`, { name: "Renamed" });
    expect(nameOnly.statusCode).toBe(200);
    const v2 = json(await client.patch(`/api/studies/${s.study.id}`, { goalTarget: "/welcome", createNewVersion: true }));
    expect(v2.currentVersion.version).toBe(2);
    expect(v2.status).toBe("draft");
    const old = await h.db.studyVersion.findUniqueOrThrow({ where: { studyId_version: { studyId: s.study.id, version: 1 } } });
    expect(old.goalTarget).toBe("/dashboard");
  });
});
