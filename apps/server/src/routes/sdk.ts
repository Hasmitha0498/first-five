/**
 * SDK-facing endpoints (contract: packages/sdk-contract, docs/integrations/SDK_INTEGRATION.md).
 * Called cross-origin from customer websites; never use cookies. CORS is
 * granted only to origins registered on some project, and each handler then
 * enforces the specific project's allowlist.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { EndRequestSchema, SDK_LIMITS, type EndResponse } from "@firstfive/sdk-contract";
import { z } from "zod";
import type { AppContext } from "../context";
import { sha256 } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { endSession, feedbackUrlFor } from "../services/sessions";
import { exchangeTicket, finishSetup, getSdkConfig, getSessionState, ingestEvents, isRegisteredOrigin, resolveCredential } from "../services/sdk";

declare module "fastify" {
  interface FastifyRequest {
    sdkAllowedOrigin?: string | null;
  }
}

export async function sdkRoutes(app: FastifyInstance, ctx: AppContext) {
  const originCache = new Map<string, { allowed: boolean; at: number }>();
  const registered = async (origin: string) => {
    const hit = originCache.get(origin);
    if (hit && Date.now() - hit.at < 30_000) return hit.allowed;
    const allowed = await isRegisteredOrigin(ctx, origin);
    originCache.set(origin, { allowed, at: Date.now() });
    if (originCache.size > 5000) originCache.clear();
    return allowed;
  };

  app.addHook("onRequest", async (req: FastifyRequest) => {
    const origin = req.headers.origin;
    req.sdkAllowedOrigin = origin && (await registered(origin)) ? origin : null;
  });

  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Vary", "Origin");
    reply.header("Cache-Control", "no-store");
    if (req.sdkAllowedOrigin) reply.header("Access-Control-Allow-Origin", req.sdkAllowedOrigin);
  });

  app.options("/api/sdk/*", async (req, reply) => {
    if (req.sdkAllowedOrigin) {
      reply
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "content-type, authorization")
        .header("Access-Control-Max-Age", "600");
    }
    return reply.status(204).send();
  });

  const credentialKey = (req: FastifyRequest) => `sdk:${sha256(String(req.headers.authorization ?? req.ip)).slice(0, 24)}`;

  app.get(
    "/api/sdk/config",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const q = z.object({ project_id: z.string().regex(/^ffp_[a-z0-9]{8,40}$/), sdk_version: z.string().max(40).optional() }).safeParse(req.query);
      if (!q.success) throw new AppError(400, "invalid_request", "project_id is required.");
      const { body, allowOrigin } = await getSdkConfig(ctx, q.data.project_id, req.headers.origin, q.data.sdk_version);
      req.sdkAllowedOrigin = allowOrigin;
      return reply.header("Cache-Control", "no-store").send(body);
    },
  );

  app.post("/api/sdk/exchange", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) =>
    exchangeTicket(ctx, req.body, req.headers.origin),
  );

  app.get("/api/sdk/session", { config: { rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: credentialKey } } }, async (req) => {
    const r = await resolveCredential(ctx, req.headers.authorization, req.headers.origin);
    return getSessionState(ctx, r);
  });

  app.post(
    "/api/sdk/events",
    { bodyLimit: SDK_LIMITS.maxBodyBytes, config: { rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: credentialKey } } },
    async (req, reply) => {
      const r = await resolveCredential(ctx, req.headers.authorization, req.headers.origin);
      const result = await ingestEvents(ctx, r, req.body);
      return reply.status(result.rejected.length && !result.accepted.length && !result.duplicates.length ? 422 : 200).send(result);
    },
  );

  app.post("/api/sdk/session/end", { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: credentialKey } } }, async (req): Promise<EndResponse> => {
    const r = await resolveCredential(ctx, req.headers.authorization, req.headers.origin);
    if (r.credential.mode !== "live" || !r.session) throw new AppError(403, "credential_scope", "Not a live study credential.");
    const { reason } = EndRequestSchema.parse(req.body);
    const result = await endSession(ctx, r.session.id, reason, "sdk");
    return {
      session_status: result.status,
      final_reason: result.finalReason,
      feedback_url: result.feedbackTicket ? feedbackUrlFor(ctx.config.appUrl, r.session.study.publicId, result.feedbackTicket) : null,
    };
  });

  app.post("/api/sdk/setup/finish", async (req) => {
    const r = await resolveCredential(ctx, req.headers.authorization, req.headers.origin);
    return finishSetup(ctx, r);
  });
}
