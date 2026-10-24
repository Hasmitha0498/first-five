/**
 * Live end-to-end check of the AgenticOrg UX Director integration.
 *
 * Starts a throwaway PostgreSQL, applies migrations, builds the real app and
 * drives the real API: builder signup → website → launched study → five
 * synthetic participant attempts (SDK contract requests) → post-task interview
 * (live contextual question) → "Run analysis" (live report run) → draft report.
 *
 * Calls the REAL AgenticOrg agents (costs a few LLM cents; visible in the tenant).
 *   AGENTICORG_BASE_URL=… AGENTICORG_API_KEY=… AGENTICORG_Q2_AGENT_ID=… \
 *   AGENTICORG_REPORT_AGENT_ID=… npx tsx scripts/agenticorg-live-check.ts
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/server/src/app";
import { loadConfig } from "../apps/server/src/config";
import { createDb } from "../apps/server/src/db";
import { generateCodes } from "../apps/server/src/services/access-codes";

const APP_URL = "http://localhost:3000";
const SITE = "https://wanderloom-demo.example.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  cookies: Record<string, string> = {};
  constructor(private readonly app: FastifyInstance) {}
  async req(method: "GET" | "POST", url: string, body?: unknown, headers: Record<string, string> = {}) {
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await this.app.inject({ method, url, payload: body as object | undefined, headers: { origin: APP_URL, ...(cookie ? { cookie } : {}), ...headers } });
    for (const c of res.cookies as { name: string; value: string }[]) this.cookies[c.name] = c.value;
    if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body.slice(0, 300)}`);
    return res.json();
  }
  get = (url: string, headers?: Record<string, string>) => this.req("GET", url, undefined, headers);
  post = (url: string, body: unknown = {}, headers?: Record<string, string>) => this.req("POST", url, body, headers);
}

const ev = (base: object, seq: number, fields: object) => ({ schema_version: 1, event_id: randomUUID(), client_sequence: seq, timestamp: new Date(Date.now() + seq * 4000).toISOString(), ...base, ...fields });

const JOURNEYS: { reachGoal: boolean; pages: string[]; clicks?: { page: string; id: string; label: string }[]; q2: string; q3: string }[] = [
  { reachGoal: true, pages: ["/", "/pricing", "/", "/pricing", "/signup", "/dashboard"], q2: "I wanted to know if there was a free plan before giving my email.", q3: "Show the free plan next to the sign up button." },
  { reachGoal: false, pages: ["/", "/signup", "/pricing"], q2: "I couldn't tell what it costs after the trial.", q3: "Put the price on the sign up page." },
  { reachGoal: true, pages: ["/", "/signup", "/dashboard"], clicks: [{ page: "/signup", id: "create-account", label: "Create account" }], q2: "Nothing really, it was straightforward.", q3: "It was fine." },
  { reachGoal: false, pages: ["/", "/signup", "/help"], clicks: [{ page: "/signup", id: "create-account", label: "Create account" }, { page: "/signup", id: "create-account", label: "Create account" }], q2: "The button did nothing the first time so I looked for help.", q3: "Tell me what went wrong when the form fails." },
  { reachGoal: true, pages: ["/", "/pricing", "/signup", "/dashboard"], q2: "I checked pricing first to see if it was worth signing up.", q3: "Make pricing clearer on the home page." },
];

async function main() {
  for (const k of ["AGENTICORG_BASE_URL", "AGENTICORG_API_KEY", "AGENTICORG_Q2_AGENT_ID", "AGENTICORG_REPORT_AGENT_ID"]) {
    if (!process.env[k]) throw new Error(`${k} is required`);
  }
  const dir = resolve(".data/live-check-pg");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(resolve(".data"), { recursive: true });
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "firstfive", password: "firstfive", port: 54331, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("firstfive_live");
  const url = "postgresql://firstfive:firstfive@localhost:54331/firstfive_live";
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

  const config = loadConfig({ ...process.env, NODE_ENV: "test", DATABASE_URL: url, APP_URL, SESSION_SECRET: "live-check-secret-live-check-secret-0123", DISABLE_SCHEDULER: "true", LOG_LEVEL: "warn" });
  const db = createDb(url);
  const { app, ctx } = await buildApp({ config, db, logger: false, webDistDir: null });
  await app.ready();
  try {
    console.log(`UX Director configured=${ctx.providers.uxDirector.configured} approvalsConfigured=${ctx.providers.uxDirector.approvalsConfigured}`);

    // Builder with access, a connected website and a launched study.
    const builder = new Client(app);
    await builder.post("/api/auth/signup", { email: `live-check-${Date.now()}@example.com`, password: "correct-horse-battery" });
    const { codes } = await generateCodes(ctx, { label: "live check", audience: "internal", planKey: "complimentary", studyCredits: 1, participantCap: 5, count: 1, maxRedemptions: 1 });
    await builder.post("/api/access/redeem", { code: codes[0] });
    const project = await builder.post("/api/projects", { name: "Wanderloom demo", websiteUrl: SITE });
    const setup = await builder.post(`/api/projects/${project.id}/setup-sessions`);
    const sx = await app.inject({ method: "POST", url: "/api/sdk/exchange", headers: { origin: SITE }, payload: { project_id: project.publicId, ticket: new URL(setup.launchUrl).hash.replace(/^#ff_setup=/, "") } });
    const setupCred = sx.json().credential as string;
    const sbase = { project_id: project.publicId, mode: "setup" };
    const setupEvents = ["/", "/pricing", "/signup", "/help", "/dashboard"].map((p, i) => ev(sbase, i, { event_name: "ff_page_viewed", page_path: p }));
    setupEvents.push(ev(sbase, 9, { event_name: "ff_element_discovered", page_path: "/signup", element_id: "create-account", element_type: "button", element_label: "Create account" }));
    await app.inject({ method: "POST", url: "/api/sdk/events", headers: { origin: SITE, authorization: `Bearer ${setupCred}` }, payload: { schema_version: 1, sdk_version: "live-check", events: setupEvents } });
    const draft = await builder.post("/api/studies", { projectId: project.id, name: "Onboarding", task: "Create an account and reach your dashboard.", startPath: "/", goalType: "page_reached", goalTarget: "/dashboard", timeLimitSeconds: 300, participantLimit: 5 });
    const study = await builder.post(`/api/studies/${draft.id}/launch`);
    console.log(`Study ${study.publicId} launched`);

    // Five participants: attempt → events → end → interview (live Q2) → answers.
    for (const [i, j] of JOURNEYS.entries()) {
      const p = new Client(app);
      const attempt = await p.post(`/api/public/studies/${study.publicId}/attempts`, { consent: true });
      const ex = await app.inject({ method: "POST", url: "/api/sdk/exchange", headers: { origin: SITE }, payload: { project_id: project.publicId, ticket: new URL(attempt.launchUrl).hash.replace(/^#ff_launch=/, "") } });
      const cred = ex.json().credential as string;
      const base = { project_id: project.publicId, mode: "live", study_id: study.publicId, session_id: attempt.sessionId };
      let seq = 0;
      const events: object[] = [];
      for (const page of j.pages) {
        events.push(ev(base, seq++, { event_name: "ff_page_viewed", page_path: page }));
        for (const c of (j.clicks ?? []).filter((c) => c.page === page)) events.push(ev(base, seq++, { event_name: "ff_element_clicked", page_path: page, element_id: c.id, element_type: "button", element_label: c.label }));
      }
      await app.inject({ method: "POST", url: "/api/sdk/events", headers: { origin: SITE, authorization: `Bearer ${cred}` }, payload: { schema_version: 1, sdk_version: "live-check", events } });
      const end = (await app.inject({ method: "POST", url: "/api/sdk/session/end", headers: { origin: SITE, authorization: `Bearer ${cred}` }, payload: { reason: j.reachGoal ? "finished" : "gave_up" } })).json();
      const token = new URL(end.feedback_url).hash.replace("#h=", "");
      const t0 = Date.now();
      const qs = await p.get(`/api/public/studies/${study.publicId}/feedback`, { "x-ff-feedback": token });
      const q2 = qs.questions.find((q: { key: string }) => q.key === "q2_context");
      console.log(`P${i + 1} ${end.outcome ?? ""} Q2 [${q2.source}, ${Date.now() - t0} ms]: ${q2.text}`);
      await p.post(
        `/api/public/studies/${study.publicId}/feedback`,
        { answers: [{ questionKey: "q1_ease", status: "answered", choice: j.reachGoal ? "5" : "2" }, { questionKey: "q2_context", status: "answered", text: j.q2 }, { questionKey: "q3_improve", status: "answered", text: j.q3 }] },
        { "x-ff-feedback": token },
      );
    }

    // Run analysis (live report run) and wait for the background job.
    const started = await builder.post(`/api/studies/${draft.id}/analyze`);
    console.log(`Analysis requested: report ${started.id} status=${started.status}`);
    const t0 = Date.now();
    let report = started;
    while (report.status === "processing" && Date.now() - t0 < 200_000) {
      await sleep(3000);
      report = await builder.get(`/api/reports/${started.id}`);
    }
    console.log(`Report status=${report.status} after ${Math.round((Date.now() - t0) / 1000)} s; run=${report.externalRunId}`);
    if (report.failureReason) console.log(`Failure: ${report.failureReason}`);
    for (const f of report.findings) {
      console.log(`\n• ${f.title} [${f.evidenceStrength}] affected=${f.affectedCount} counter=${f.counterSessions.length}`);
      console.log(`  observed: ${f.observed}`);
      for (const q of f.quotes) console.log(`  quote: "${q.text}"`);
      console.log(`  suggestion: ${f.suggestion}`);
      console.log(`  retest: ${f.retestMetric}`);
      console.log(`  prompt: ${String(f.assistantPrompt).slice(0, 240)}`);
    }
    const runs = await db.agentRun.findMany({ orderBy: { startedAt: "asc" } });
    console.log("\nagent_runs:");
    for (const r of runs) console.log(`  ${r.kind} ${r.status} ext=${r.externalRunId ?? "-"} ${r.error ? `err=${r.error.slice(0, 120)}` : ""}`);
    const publish = await app.inject({ method: "POST", url: `/api/reports/${started.id}/publish`, headers: { origin: APP_URL, cookie: Object.entries(builder.cookies).map(([k, v]) => `${k}=${v}`).join("; ") } });
    console.log(`\nPublish before AgenticOrg approval → HTTP ${publish.statusCode} ${publish.json().code ?? ""}`);
  } finally {
    await app.close();
    await db.$disconnect();
    await pg.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
