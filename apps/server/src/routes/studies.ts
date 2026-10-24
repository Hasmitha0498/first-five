import type { FastifyInstance } from "fastify";
import { FindingInputSchema } from "@firstfive/shared";
import { z } from "zod";
import type { AppContext } from "../context";
import { requireUser, userId } from "../http";
import { assertHasAccess } from "../services/entitlements";
import * as dashboard from "../services/dashboard";
import * as reports from "../services/reports";
import * as studies from "../services/studies";

const IdParam = z.object({ id: z.string().uuid() });
const VersionQuery = z.object({ version: z.coerce.number().int().positive().optional(), status: z.enum(["pending", "completed", "dropped", "invalid"]).optional() });

export async function studyRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook("preHandler", requireUser);
  // Workspace requires real access (verified payment or invitation code). Used-up grants still allow viewing prior work.
  app.addHook("preHandler", async (req) => assertHasAccess(ctx.db, userId(req)));

  app.get("/api/studies", async (req) => ({ studies: await studies.listStudies(ctx, userId(req)) }));

  app.post("/api/studies", async (req, reply) => reply.status(201).send(await studies.createStudy(ctx, userId(req), req.body)));

  app.get("/api/studies/:id", async (req) => studies.getStudyDetail(ctx, userId(req), IdParam.parse(req.params).id));

  app.patch("/api/studies/:id", async (req) => studies.updateStudy(ctx, userId(req), IdParam.parse(req.params).id, req.body));

  app.delete("/api/studies/:id", async (req) => {
    await studies.deleteStudy(ctx, userId(req), IdParam.parse(req.params).id);
    return { ok: true };
  });

  app.post("/api/studies/:id/launch", async (req) => studies.launchStudy(ctx, userId(req), IdParam.parse(req.params).id));
  app.post("/api/studies/:id/pause", async (req) => studies.setStudyLifecycle(ctx, userId(req), IdParam.parse(req.params).id, "pause"));
  app.post("/api/studies/:id/resume", async (req) => studies.setStudyLifecycle(ctx, userId(req), IdParam.parse(req.params).id, "resume"));
  app.post("/api/studies/:id/close", async (req) => studies.setStudyLifecycle(ctx, userId(req), IdParam.parse(req.params).id, "close"));

  app.get("/api/studies/:id/dashboard", async (req) => {
    const { version } = VersionQuery.parse(req.query);
    return dashboard.getDashboard(ctx, userId(req), IdParam.parse(req.params).id, version);
  });

  app.get("/api/studies/:id/sessions", async (req) => {
    const q = VersionQuery.parse(req.query);
    return { sessions: await dashboard.listSessions(ctx, userId(req), IdParam.parse(req.params).id, q) };
  });

  app.get("/api/studies/:id/quotes", async (req) => ({ quotes: await dashboard.listQuotes(ctx, userId(req), IdParam.parse(req.params).id) }));

  app.get("/api/sessions/:id/details", async (req) => dashboard.getSessionDetail(ctx, userId(req), IdParam.parse(req.params).id));

  app.get("/api/studies/:id/reports", async (req) => {
    const s = await studies.getOwnedStudy(ctx, userId(req), IdParam.parse(req.params).id);
    return { reports: await reports.listReportsForStudy(ctx, s.id) };
  });
  app.post("/api/studies/:id/reports", async (req, reply) => reply.status(201).send(await reports.createOwnerReport(ctx, userId(req), IdParam.parse(req.params).id)));
  app.post("/api/studies/:id/analyze", async (req) => reports.requestAnalysis(ctx, userId(req), IdParam.parse(req.params).id));

  // Reports
  const ReportParam = z.object({ id: z.string().uuid() });
  const FindingParam = z.object({ id: z.string().uuid(), findingId: z.string().uuid() });
  app.get("/api/reports", async (req) => ({ reports: await reports.listReports(ctx, userId(req)) }));
  app.get("/api/reports/:id", async (req) => reports.getReportDetail(ctx, userId(req), ReportParam.parse(req.params).id));
  app.patch("/api/reports/:id", async (req) => {
    const input = z.object({ title: z.string().trim().min(1).max(120).optional(), summary: z.string().trim().max(3000).nullable().optional() }).parse(req.body);
    return reports.updateReportMeta(ctx, userId(req), ReportParam.parse(req.params).id, input);
  });
  app.post("/api/reports/:id/refresh-metrics", async (req) => reports.refreshSnapshot(ctx, userId(req), ReportParam.parse(req.params).id));
  app.post("/api/reports/:id/findings", async (req) => reports.addFinding(ctx, userId(req), ReportParam.parse(req.params).id, FindingInputSchema.parse(req.body)));
  app.put("/api/reports/:id/findings/:findingId", async (req) => {
    const p = FindingParam.parse(req.params);
    return reports.updateFinding(ctx, userId(req), p.id, p.findingId, req.body);
  });
  app.delete("/api/reports/:id/findings/:findingId", async (req) => {
    const p = FindingParam.parse(req.params);
    return reports.deleteFinding(ctx, userId(req), p.id, p.findingId);
  });
  app.post("/api/reports/:id/request-review", async (req) => reports.requestReview(ctx, userId(req), ReportParam.parse(req.params).id));
  app.post("/api/reports/:id/review", async (req) => reports.reviewReport(ctx, userId(req), ReportParam.parse(req.params).id, req.body));
  app.post("/api/reports/:id/reopen", async (req) => reports.reopenReport(ctx, userId(req), ReportParam.parse(req.params).id));
  app.post("/api/reports/:id/publish", async (req) => reports.publishReport(ctx, userId(req), ReportParam.parse(req.params).id));
  app.post("/api/reports/:id/unpublish", async (req) => reports.unpublishReport(ctx, userId(req), ReportParam.parse(req.params).id));
}
