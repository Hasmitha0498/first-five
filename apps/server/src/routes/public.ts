import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PublicStudyInfo } from "@firstfive/shared";
import { CONSENT_TEXT_VERSION, StartAttemptSchema } from "@firstfive/shared";
import { END_REASONS } from "@firstfive/sdk-contract";
import { z } from "zod";
import type { AppContext } from "../context";
import { notFound } from "../lib/errors";
import { getFeedbackSession, submitFeedback } from "../services/interview";
import { getPublishedReport } from "../services/reports";
import {
  endAttemptForParticipant,
  getAttemptForParticipant,
  getPublicStudy,
  participantCookieName,
  publicStudyStatus,
  reconcileExpired,
  startAttempt,
} from "../services/sessions";

const StudyParam = z.object({ publicId: z.string().regex(/^ffs_[a-z0-9]{8,40}$/) });
const FEEDBACK_HEADER = "x-ff-feedback";

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  const participantToken = (req: FastifyRequest, studyPublicId: string) => req.cookies[participantCookieName(studyPublicId)];

  app.get("/api/public/studies/:publicId", async (req): Promise<PublicStudyInfo> => {
    const { publicId } = StudyParam.parse(req.params);
    await reconcileExpired(ctx, { studyPublicId: publicId });
    const study = await getPublicStudy(ctx, publicId);
    const status = publicStudyStatus(study);
    if (status === "not_launched") throw notFound("Test");
    const version = await ctx.db.studyVersion.findUniqueOrThrow({ where: { studyId_version: { studyId: study.id, version: study.currentVersion } } });
    return {
      studyId: study.publicId,
      name: study.name,
      task: version.task,
      timeLimitSeconds: version.timeLimitSeconds,
      websiteName: study.project.name,
      status,
      consentTextVersion: CONSENT_TEXT_VERSION,
      existingAttempt: await getAttemptForParticipant(ctx, publicId, participantToken(req, publicId)),
    };
  });

  app.post(
    "/api/public/studies/:publicId/attempts",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { publicId } = StudyParam.parse(req.params);
      StartAttemptSchema.parse(req.body);
      const { newToken, attempt } = await startAttempt(ctx, publicId, participantToken(req, publicId));
      if (newToken) {
        reply.setCookie(participantCookieName(publicId), newToken, {
          httpOnly: true,
          secure: ctx.config.secureCookies,
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 3600,
        });
      }
      return reply.status(201).send(attempt);
    },
  );

  app.get("/api/public/studies/:publicId/attempt", async (req) => {
    const { publicId } = StudyParam.parse(req.params);
    const attempt = await getAttemptForParticipant(ctx, publicId, participantToken(req, publicId));
    if (!attempt) throw notFound("Attempt");
    return attempt;
  });

  app.post("/api/public/studies/:publicId/attempt/end", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req) => {
    const { publicId } = StudyParam.parse(req.params);
    const { reason } = z.object({ reason: z.enum(END_REASONS) }).parse(req.body);
    return endAttemptForParticipant(ctx, publicId, participantToken(req, publicId), reason);
  });

  app.get("/api/public/studies/:publicId/feedback", async (req) => {
    const { publicId } = StudyParam.parse(req.params);
    return getFeedbackSession(ctx, publicId, req.headers[FEEDBACK_HEADER] as string | undefined);
  });

  app.post("/api/public/studies/:publicId/feedback", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req) => {
    const { publicId } = StudyParam.parse(req.params);
    return submitFeedback(ctx, publicId, req.headers[FEEDBACK_HEADER] as string | undefined, req.body);
  });

  app.get("/api/public/reports/:token", async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(64) }).parse(req.params);
    return getPublishedReport(ctx, token);
  });
}
