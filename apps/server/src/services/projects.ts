import type { ConnectionCheck, ProjectDetail, ProjectSummary, SnippetInfo } from "@firstfive/shared";
import { INTEGRATION_STATUS_HELP } from "@firstfive/shared";
import { HANDOFF_FRAGMENT_KEYS, SNIPPET_ATTRIBUTES } from "@firstfive/sdk-contract";
import type { Project, ProjectOrigin } from "@prisma/client";
import type { AppConfig } from "../config";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { publicId, randomToken, sha256 } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { normalizeOrigin, normalizeWebsiteUrl } from "../lib/url";
import { assertCanCreateProject } from "./entitlements";
import { recordConversion } from "./conversions";

export const SETUP_SESSION_TTL_MS = 30 * 60 * 1000;
export const SETUP_TICKET_TTL_MS = 10 * 60 * 1000;

const PREVIEW_SCRIPT_URL = "https://YOUR-SDK-HOST/v1/firstfive.js";

export function buildSnippet(config: AppConfig, projectPublicId: string): SnippetInfo {
  const isPreview = !config.SDK_SCRIPT_URL;
  const scriptUrl = config.SDK_SCRIPT_URL ?? PREVIEW_SCRIPT_URL;
  const html = [
    "<script",
    "  async",
    `  src="${scriptUrl}"`,
    `  ${SNIPPET_ATTRIBUTES.project}="${projectPublicId}"`,
    `  ${SNIPPET_ATTRIBUTES.api}="${config.appUrl}">`,
    "</script>",
  ].join("\n");
  const assistantPrompt =
    "Add the following First Five installation snippet to my website's shared application layout so it loads across the application. " +
    "Preserve all existing functionality. Do not collect sensitive input values. Deploy the change and confirm when the script is available.\n\n" +
    html;
  return { isPreview, scriptUrl, apiBaseUrl: config.appUrl, html, assistantPrompt };
}

export async function getOwnedProject(ctx: AppContext, userId: string, projectId: string) {
  // Ownership is part of the query: a project owned by someone else is indistinguishable from a missing one.
  const project = await ctx.db.project.findFirst({ where: { id: projectId, ownerId: userId } });
  if (!project) throw notFound("Website");
  return project;
}

export async function createProject(ctx: AppContext, userId: string, input: { name: string; websiteUrl: string; description?: string }) {
  await assertCanCreateProject(ctx.db, ctx.config, userId);
  const { url, origin } = normalizeWebsiteUrl(input.websiteUrl, { allowLocalhost: !ctx.config.isProduction });
  return ctx.db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        ownerId: userId,
        publicId: publicId("ffp"),
        name: input.name,
        description: input.description || null,
        websiteUrl: url,
        canonicalOrigin: origin,
        origins: { create: { origin } },
        sdkConfig: { create: {} },
      },
    });
    await audit(tx, {
      actorUserId: userId,
      actorType: "user",
      action: "project.created",
      resourceType: "project",
      resourceId: project.id,
      metadata: { publicId: project.publicId, origin },
    });
    await recordConversion(tx, ctx.config, "project_created", { userId });
    return project;
  });
}

export async function addOrigin(ctx: AppContext, userId: string, projectId: string, rawOrigin: string) {
  const project = await getOwnedProject(ctx, userId, projectId);
  const origin = normalizeOrigin(rawOrigin, { allowLocalhost: !ctx.config.isProduction });
  await ctx.db.projectOrigin.upsert({
    where: { projectId_origin: { projectId: project.id, origin } },
    create: { projectId: project.id, origin },
    update: {},
  });
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "project.origin_added", resourceType: "project", resourceId: project.id, metadata: { origin } });
}

export async function removeOrigin(ctx: AppContext, userId: string, projectId: string, origin: string) {
  const project = await getOwnedProject(ctx, userId, projectId);
  if (origin === project.canonicalOrigin) {
    throw new AppError(409, "canonical_origin", "The main website address can't be removed.");
  }
  await ctx.db.projectOrigin.deleteMany({ where: { projectId: project.id, origin } });
}

export async function listProjects(ctx: AppContext, userId: string): Promise<ProjectSummary[]> {
  const projects = await ctx.db.project.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { studies: true } } },
  });
  return projects.map((p) => toSummary(p, p._count.studies));
}

function toSummary(p: Project, studyCount: number): ProjectSummary {
  return {
    id: p.id,
    publicId: p.publicId,
    name: p.name,
    websiteUrl: p.websiteUrl,
    description: p.description,
    integrationStatus: p.integrationStatus,
    studyCount,
    lastActivityAt: p.lastActivityAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function getProjectDetail(ctx: AppContext, userId: string, projectId: string): Promise<ProjectDetail> {
  const p = await getOwnedProject(ctx, userId, projectId);
  const [origins, studyCount] = await Promise.all([
    ctx.db.projectOrigin.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "asc" } }),
    ctx.db.study.count({ where: { projectId: p.id } }),
  ]);
  return toDetail(ctx.config, p, origins, studyCount);
}

function toDetail(config: AppConfig, p: Project, origins: ProjectOrigin[], studyCount: number): ProjectDetail {
  return {
    ...toSummary(p, studyCount),
    canonicalOrigin: p.canonicalOrigin,
    origins: origins.map((o) => ({ origin: o.origin, verifiedAt: o.verifiedAt?.toISOString() ?? null })),
    lastConfigPingAt: p.lastConfigPingAt?.toISOString() ?? null,
    firstConnectedAt: p.firstConnectedAt?.toISOString() ?? null,
    lastSdkVersion: p.lastSdkVersion,
    lastIssue: p.lastIssue,
    lastIssueAt: p.lastIssueAt?.toISOString() ?? null,
    snippet: buildSnippet(config, p.publicId),
  };
}

/** Builder has copied the snippet: we are now waiting for the website to connect. */
export async function markSnippetCopied(ctx: AppContext, userId: string, projectId: string) {
  const p = await getOwnedProject(ctx, userId, projectId);
  if (p.integrationStatus === "setup_not_started") {
    await ctx.db.project.update({ where: { id: p.id }, data: { integrationStatus: "awaiting_connection" } });
  }
}

/**
 * Connection check based only on evidence actually received from the SDK.
 * Never simulates success.
 */
export async function checkConnection(ctx: AppContext, userId: string, projectId: string): Promise<ConnectionCheck> {
  const p = await getOwnedProject(ctx, userId, projectId);
  let status = p.integrationStatus;
  if (p.firstConnectedAt) status = p.lastIssueAt && (!p.lastActivityAt || p.lastIssueAt > p.lastActivityAt) ? "connection_issue" : "connected";
  else if (p.lastConfigPingAt) status = "verification_needed";
  else if (p.lastIssueAt) status = "connection_issue";
  else status = "awaiting_connection";
  if (status !== p.integrationStatus) {
    await ctx.db.project.update({ where: { id: p.id }, data: { integrationStatus: status } });
  }
  return {
    integrationStatus: status,
    checkedAt: new Date().toISOString(),
    lastConfigPingAt: p.lastConfigPingAt?.toISOString() ?? null,
    lastActivityAt: p.lastActivityAt?.toISOString() ?? null,
    lastIssue: p.lastIssue,
    message: INTEGRATION_STATUS_HELP[status],
  };
}

/** Starts an authorized setup walkthrough and returns the one-time launch URL. */
export async function startSetupSession(ctx: AppContext, userId: string, projectId: string) {
  const p = await getOwnedProject(ctx, userId, projectId);
  const ticket = randomToken();
  const now = Date.now();
  const result = await ctx.db.$transaction(async (tx) => {
    await tx.setupSession.updateMany({
      where: { projectId: p.id, status: "active" },
      data: { status: "finished", endedAt: new Date(now) },
    });
    const setup = await tx.setupSession.create({
      data: { projectId: p.id, createdById: userId, expiresAt: new Date(now + SETUP_SESSION_TTL_MS) },
    });
    await tx.sdkTicket.create({
      data: {
        kind: "setup_launch",
        tokenHash: sha256(ticket),
        projectId: p.id,
        setupSessionId: setup.id,
        expiresAt: new Date(now + SETUP_TICKET_TTL_MS),
      },
    });
    return setup;
  });
  if (p.integrationStatus === "setup_not_started") {
    await ctx.db.project.update({ where: { id: p.id }, data: { integrationStatus: "awaiting_connection" } });
  }
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "setup_session.started", resourceType: "project", resourceId: p.id });
  const launch = new URL(p.websiteUrl);
  launch.hash = `${HANDOFF_FRAGMENT_KEYS.setup}=${ticket}`;
  return { setupSessionId: result.id, launchUrl: launch.href, expiresAt: result.expiresAt.toISOString() };
}

export async function getDiscovery(ctx: AppContext, userId: string, projectId: string) {
  const p = await getOwnedProject(ctx, userId, projectId);
  const [pages, elements, customEvents, active] = await Promise.all([
    ctx.db.discoveredPage.findMany({ where: { projectId: p.id }, orderBy: { firstSeenAt: "asc" } }),
    ctx.db.discoveredElement.findMany({ where: { projectId: p.id }, orderBy: [{ pagePath: "asc" }, { firstSeenAt: "asc" }] }),
    ctx.db.discoveredCustomEvent.findMany({ where: { projectId: p.id }, orderBy: { firstSeenAt: "asc" } }),
    ctx.db.setupSession.findFirst({ where: { projectId: p.id, status: "active", expiresAt: { gt: new Date() } }, orderBy: { startedAt: "desc" } }),
  ]);
  return {
    integrationStatus: p.integrationStatus,
    lastActivityAt: p.lastActivityAt?.toISOString() ?? null,
    pages: pages.map((x) => ({ path: x.path, viewCount: x.viewCount, firstSeenAt: x.firstSeenAt.toISOString(), lastSeenAt: x.lastSeenAt.toISOString() })),
    elements: elements.map((e) => ({
      id: e.id,
      pagePath: e.pagePath,
      elementKey: e.elementKey,
      elementType: e.elementType,
      safeLabel: e.safeLabel,
      wasClicked: e.wasClicked,
      firstSeenAt: e.firstSeenAt.toISOString(),
      lastSeenAt: e.lastSeenAt.toISOString(),
    })),
    customEvents: customEvents.map((c) => ({ eventName: c.eventName, lastSeenAt: c.lastSeenAt.toISOString() })),
    activeSetupSession: active ? { id: active.id, expiresAt: active.expiresAt.toISOString(), eventCount: active.eventCount } : null,
  };
}

export async function deleteProject(ctx: AppContext, userId: string, projectId: string) {
  const p = await getOwnedProject(ctx, userId, projectId);
  await ctx.db.project.delete({ where: { id: p.id } });
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "project.deleted", resourceType: "project", resourceId: p.id });
}
