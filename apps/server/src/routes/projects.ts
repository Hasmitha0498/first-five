import type { FastifyInstance } from "fastify";
import { AddOriginSchema, CreateProjectSchema } from "@firstfive/shared";
import { z } from "zod";
import type { AppContext } from "../context";
import { requireUser, userId } from "../http";
import { assertHasAccess } from "../services/entitlements";
import * as projects from "../services/projects";
import { listStudies } from "../services/studies";

const IdParam = z.object({ id: z.string().uuid() });

export async function projectRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook("preHandler", requireUser);
  // Workspace requires real access (verified payment or invitation code). Used-up grants still allow viewing prior work.
  app.addHook("preHandler", async (req) => assertHasAccess(ctx.db, userId(req)));

  app.get("/api/projects", async (req) => ({ projects: await projects.listProjects(ctx, userId(req)) }));

  app.post("/api/projects", async (req, reply) => {
    const input = CreateProjectSchema.parse(req.body);
    const p = await projects.createProject(ctx, userId(req), input);
    return reply.status(201).send(await projects.getProjectDetail(ctx, userId(req), p.id));
  });

  app.get("/api/projects/:id", async (req) => {
    const { id } = IdParam.parse(req.params);
    return projects.getProjectDetail(ctx, userId(req), id);
  });

  app.delete("/api/projects/:id", async (req) => {
    const { id } = IdParam.parse(req.params);
    await projects.deleteProject(ctx, userId(req), id);
    return { ok: true };
  });

  app.post("/api/projects/:id/origins", async (req) => {
    const { id } = IdParam.parse(req.params);
    const { origin } = AddOriginSchema.parse(req.body);
    await projects.addOrigin(ctx, userId(req), id, origin);
    return projects.getProjectDetail(ctx, userId(req), id);
  });

  app.delete("/api/projects/:id/origins", async (req) => {
    const { id } = IdParam.parse(req.params);
    const { origin } = AddOriginSchema.parse(req.body);
    await projects.removeOrigin(ctx, userId(req), id, origin);
    return projects.getProjectDetail(ctx, userId(req), id);
  });

  app.post("/api/projects/:id/snippet-copied", async (req) => {
    const { id } = IdParam.parse(req.params);
    await projects.markSnippetCopied(ctx, userId(req), id);
    return { ok: true };
  });

  app.post("/api/projects/:id/check-connection", async (req) => {
    const { id } = IdParam.parse(req.params);
    return projects.checkConnection(ctx, userId(req), id);
  });

  // Starts an authorized setup walkthrough (PRD: POST /api/sdk/setup/start).
  app.post("/api/projects/:id/setup-sessions", async (req) => {
    const { id } = IdParam.parse(req.params);
    return projects.startSetupSession(ctx, userId(req), id);
  });

  app.get("/api/projects/:id/discovery", async (req) => {
    const { id } = IdParam.parse(req.params);
    return projects.getDiscovery(ctx, userId(req), id);
  });

  app.get("/api/projects/:id/studies", async (req) => {
    const { id } = IdParam.parse(req.params);
    await projects.getOwnedProject(ctx, userId(req), id);
    return { studies: await listStudies(ctx, userId(req), id) };
  });
}
