/** Public growth endpoints: waitlist leads and privacy-conscious funnel events. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TrackEventSchema, WAITLIST_NOTICE_VERSION, WaitlistSchema } from "@firstfive/shared";
import type { AppContext } from "../context";
import { randomToken } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { normalizeWebsiteUrl } from "../lib/url";
import { recordConversion } from "../services/conversions";

export const VISITOR_COOKIE = "ff_vid";

export async function growthRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Random, first-party visitor ID (no personal data) used only to group funnel events. */
  const visitorId = (req: FastifyRequest, reply: FastifyReply): string => {
    const existing = req.cookies[VISITOR_COOKIE];
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const id = randomToken(16);
    reply.setCookie(VISITOR_COOKIE, id, { httpOnly: true, secure: ctx.config.secureCookies, sameSite: "lax", path: "/", maxAge: 365 * 24 * 3600 });
    return id;
  };

  app.post("/api/events", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = TrackEventSchema.parse(req.body);
    await recordConversion(ctx.db, ctx.config, input.name, {
      visitorId: visitorId(req, reply),
      userId: req.user?.id,
      properties: { path: input.path, placement: input.placement, ...input.utm },
    });
    return reply.status(202).send({ ok: true });
  });

  app.post("/api/waitlist", { config: { rateLimit: { max: 8, timeWindow: "1 hour" } } }, async (req, reply) => {
    const input = WaitlistSchema.parse(req.body);
    // Honeypot filled → pretend success, store nothing.
    if (input.website) return reply.status(201).send({ status: "created" });
    let productUrl: string | null = null;
    if (input.productUrl) {
      try {
        productUrl = normalizeWebsiteUrl(input.productUrl, { allowLocalhost: false }).url;
      } catch {
        throw new AppError(400, "invalid_request", "Enter a website address such as https://example.com", { productUrl: "Enter a valid website address, or leave it blank" });
      }
    }
    const utm = input.utm ?? {};
    const existing = await ctx.db.waitlistLead.findUnique({ where: { email: input.email } });
    if (existing) {
      await ctx.db.waitlistLead.update({
        where: { id: existing.id },
        data: {
          submissionCount: { increment: 1 },
          productDescription: existing.productDescription ?? input.productDescription ?? null,
          productUrl: existing.productUrl ?? productUrl,
        },
      });
      return reply.status(200).send({ status: "already_registered" });
    }
    await ctx.db.waitlistLead.create({
      data: {
        name: input.name,
        email: input.email,
        productDescription: input.productDescription ?? null,
        productUrl,
        source: input.source ?? null,
        referrer: input.referrer ?? null,
        utmSource: utm.utm_source ?? null,
        utmMedium: utm.utm_medium ?? null,
        utmCampaign: utm.utm_campaign ?? null,
        utmTerm: utm.utm_term ?? null,
        utmContent: utm.utm_content ?? null,
        noticeVersion: WAITLIST_NOTICE_VERSION,
      },
    });
    await recordConversion(ctx.db, ctx.config, "waitlist_submitted", {
      visitorId: visitorId(req, reply),
      properties: { source: input.source, ...utm },
    });
    return reply.status(201).send({ status: "created" });
  });
}
