import type { LaunchReadiness, StudyDetail, StudySummary, StudyVersionDto } from "@firstfive/shared";
import { StudyDraftSchema, StudyUpdateSchema } from "@firstfive/shared";
import type { Prisma, Project, Study, StudyVersion } from "@prisma/client";
import type { z } from "zod";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { publicId } from "../lib/crypto";
import { AppError, conflict, notFound } from "../lib/errors";
import { pathsEqual } from "../lib/url";
import { assertCanCreateStudy, assertParticipantLimit, consumeStudyCredit, getEntitlement, hasAvailableCredit } from "./entitlements";
import { recordConversion } from "./conversions";
import { getOwnedProject } from "./projects";

type StudyWithProject = Study & { project: Project };

export function shareUrl(appUrl: string, studyPublicId: string) {
  return `${appUrl}/t/${studyPublicId}`;
}

export async function getOwnedStudy(ctx: AppContext, userId: string, studyId: string) {
  const study = await ctx.db.study.findFirst({ where: { id: studyId, project: { ownerId: userId } }, include: { project: true } });
  if (!study) throw notFound("Test");
  return study;
}

export async function currentVersion(ctx: AppContext, study: Study): Promise<StudyVersion> {
  const v = await ctx.db.studyVersion.findUnique({ where: { studyId_version: { studyId: study.id, version: study.currentVersion } } });
  if (!v) throw new Error(`Study ${study.id} is missing version ${study.currentVersion}`);
  return v;
}

/** Re-derive whether the start and goal are confirmed by actual discovery data. */
async function verifyAgainstDiscovery(
  ctx: AppContext,
  projectId: string,
  def: { startPath: string; goalType: string; goalTarget: string; goalPagePath?: string | null },
) {
  const [pages, elements, customEvents] = await Promise.all([
    ctx.db.discoveredPage.findMany({ where: { projectId }, select: { path: true } }),
    ctx.db.discoveredElement.findMany({ where: { projectId, elementKey: def.goalType === "element_clicked" ? def.goalTarget : "__none__" } }),
    ctx.db.discoveredCustomEvent.findMany({ where: { projectId, eventName: def.goalType === "custom_event" ? def.goalTarget : "__none__" } }),
  ]);
  const startVerified = pages.some((p) => pathsEqual(p.path, def.startPath));
  let goalVerified = false;
  if (def.goalType === "page_reached") goalVerified = pages.some((p) => pathsEqual(p.path, def.goalTarget));
  if (def.goalType === "element_clicked") {
    goalVerified = elements.some((e) => !def.goalPagePath || pathsEqual(e.pagePath, def.goalPagePath));
  }
  if (def.goalType === "custom_event") goalVerified = customEvents.length > 0;
  return { startVerified, goalVerified };
}

export async function computeReadiness(ctx: AppContext, study: StudyWithProject, version: StudyVersion): Promise<LaunchReadiness> {
  const blockers: LaunchReadiness["blockers"] = [];
  if (study.project.integrationStatus !== "connected") {
    blockers.push({
      code: "integration_not_connected",
      message: "Your website isn't connected yet. Add First Five to your website and walk through your journey once.",
    });
  }
  const verified = await verifyAgainstDiscovery(ctx, study.projectId, version);
  if (!verified.startVerified) {
    blockers.push({
      code: "start_unverified",
      message: `We haven't seen ${version.startPath} on your website yet. Visit it during setup to confirm it.`,
    });
  }
  if (!verified.goalVerified) {
    const what =
      version.goalType === "page_reached"
        ? `the page ${version.goalTarget}`
        : version.goalType === "element_clicked"
          ? `the button or link "${version.goalTarget}"`
          : `the completion event "${version.goalTarget}"`;
    blockers.push({ code: "goal_unverified", message: `We haven't seen ${what} on your website yet. Walk through it during setup to confirm it.` });
  }
  const entitlement = await getEntitlement(ctx.db, ctx.config, study.project.ownerId);
  if (study.participantLimit > entitlement.maxParticipantsPerStudy) {
    blockers.push({ code: "participant_limit", message: `Your access allows up to ${entitlement.maxParticipantsPerStudy} participants per test.` });
  }
  if (!study.creditGrantId && !(await hasAvailableCredit(ctx.db, study.project.ownerId, study.participantLimit))) {
    blockers.push({
      code: "no_study_credits",
      message: "Launching uses one study credit, and you don't have an unused one. Get another study or redeem an invitation code.",
    });
  }
  if (study.expiresAt && study.expiresAt <= new Date()) blockers.push({ code: "expired", message: "This test's end date has passed." });
  if (!["draft", "ready", "paused"].includes(study.status)) {
    blockers.push({ code: "status", message: `A ${study.status} test can't be launched.` });
  }
  // Persist the verification flags so the dashboard reflects them.
  if (verified.startVerified !== version.startVerified || verified.goalVerified !== version.goalVerified) {
    await ctx.db.studyVersion.update({ where: { id: version.id }, data: verified });
    Object.assign(version, verified);
  }
  return { canLaunch: blockers.length === 0, blockers };
}

/** Draft ⇄ Ready is derived from readiness; other statuses are explicit lifecycle actions. */
async function syncDraftReady(ctx: AppContext, study: StudyWithProject, readiness: LaunchReadiness) {
  const target = readiness.blockers.filter((b) => b.code !== "status").length === 0 ? "ready" : "draft";
  if ((study.status === "draft" || study.status === "ready") && study.status !== target) {
    await ctx.db.study.update({ where: { id: study.id }, data: { status: target } });
    study.status = target;
  }
}

export async function createStudy(ctx: AppContext, userId: string, raw: unknown) {
  const input = StudyDraftSchema.parse(raw);
  const project = await getOwnedProject(ctx, userId, input.projectId);
  const entitlement = await assertCanCreateStudy(ctx.db, ctx.config, userId);
  assertParticipantLimit(entitlement, input.participantLimit);
  validateGoal(input);
  const verified = await verifyAgainstDiscovery(ctx, project.id, input);
  const study = await ctx.db.$transaction(async (tx) => {
    const s = await tx.study.create({
      data: {
        projectId: project.id,
        publicId: publicId("ffs"),
        name: input.name,
        participantLimit: input.participantLimit,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        versions: {
          create: {
            version: 1,
            task: input.task,
            startPath: input.startPath,
            goalType: input.goalType,
            goalTarget: input.goalTarget,
            goalPagePath: input.goalPagePath ?? null,
            timeLimitSeconds: input.timeLimitSeconds,
            milestones: input.milestones as Prisma.InputJsonValue,
            repeatPolicy: input.repeatPolicy,
            ...verified,
          },
        },
      },
    });
    await audit(tx, { actorUserId: userId, actorType: "user", action: "study.created", resourceType: "study", resourceId: s.id });
    return s;
  });
  return getStudyDetail(ctx, userId, study.id);
}

function validateGoal(input: { goalType?: string; goalTarget?: string }) {
  if (input.goalType === "page_reached" && input.goalTarget && !/^\/[^\s?#]*$/.test(input.goalTarget)) {
    throw new AppError(400, "invalid_request", "Enter the destination as a path such as /dashboard", {
      goalTarget: "Use a path that starts with /",
    });
  }
  if (input.goalType === "custom_event" && input.goalTarget && !/^[a-z][a-z0-9_]{0,63}$/.test(input.goalTarget)) {
    throw new AppError(400, "invalid_request", "Custom event names use lowercase letters, numbers and underscores", {
      goalTarget: "Example: signup_completed",
    });
  }
}

const DEFINITION_FIELDS = ["task", "startPath", "goalType", "goalTarget", "goalPagePath", "timeLimitSeconds", "milestones", "repeatPolicy"] as const;

export async function updateStudy(ctx: AppContext, userId: string, studyId: string, raw: unknown) {
  const input: z.infer<typeof StudyUpdateSchema> = StudyUpdateSchema.parse(raw);
  const study = await getOwnedStudy(ctx, userId, studyId);
  const version = await currentVersion(ctx, study);
  if (["closed", "expired"].includes(study.status)) throw conflict("study_closed", "This test has ended and can't be edited.");
  if (input.participantLimit !== undefined) {
    if (study.creditGrantId) {
      const grant = await ctx.db.accessGrant.findUniqueOrThrow({ where: { id: study.creditGrantId } });
      if (input.participantLimit > grant.maxParticipantsPerStudy) {
        throw new AppError(400, "invalid_request", `This test's study credit allows up to ${grant.maxParticipantsPerStudy} participants.`, {
          participantLimit: `Up to ${grant.maxParticipantsPerStudy}`,
        });
      }
    } else {
      assertParticipantLimit(await getEntitlement(ctx.db, ctx.config, userId), input.participantLimit);
    }
  }
  const merged = { goalType: input.goalType ?? version.goalType, goalTarget: input.goalTarget ?? version.goalTarget };
  validateGoal(merged);

  const definitionChanged = DEFINITION_FIELDS.some((f) => input[f] !== undefined && JSON.stringify(input[f]) !== JSON.stringify(version[f]));
  const hasSessions = (await ctx.db.studySession.count({ where: { studyVersionId: version.id } })) > 0;

  await ctx.db.$transaction(async (tx) => {
    await tx.study.update({
      where: { id: study.id },
      data: {
        name: input.name ?? undefined,
        participantLimit: input.participantLimit ?? undefined,
        expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    if (!definitionChanged) return;
    const def = {
      task: input.task ?? version.task,
      startPath: input.startPath ?? version.startPath,
      goalType: input.goalType ?? version.goalType,
      goalTarget: input.goalTarget ?? version.goalTarget,
      goalPagePath: input.goalPagePath === undefined ? version.goalPagePath : input.goalPagePath,
      timeLimitSeconds: input.timeLimitSeconds ?? version.timeLimitSeconds,
      milestones: (input.milestones ?? version.milestones) as Prisma.InputJsonValue,
      repeatPolicy: input.repeatPolicy ?? version.repeatPolicy,
    };
    if (hasSessions || version.publishedAt) {
      // Participants have started: the published definition is immutable.
      if (!input.createNewVersion) {
        throw conflict(
          "version_locked",
          "Participants have already started this test. Save your changes as a new version so earlier results stay accurate.",
        );
      }
      await tx.studyVersion.create({ data: { studyId: study.id, version: study.currentVersion + 1, ...def } });
      await tx.study.update({
        where: { id: study.id },
        data: { currentVersion: study.currentVersion + 1, status: "draft" },
      });
      await audit(tx, {
        actorUserId: userId,
        actorType: "user",
        action: "study.version_created",
        resourceType: "study",
        resourceId: study.id,
        metadata: { version: study.currentVersion + 1 },
      });
    } else {
      await tx.studyVersion.update({ where: { id: version.id }, data: def });
    }
  });
  return getStudyDetail(ctx, userId, study.id);
}

export async function launchStudy(ctx: AppContext, userId: string, studyId: string) {
  const study = await getOwnedStudy(ctx, userId, studyId);
  const version = await currentVersion(ctx, study);
  if (study.status === "active") return getStudyDetail(ctx, userId, study.id);
  const readiness = await computeReadiness(ctx, study, version);
  if (!readiness.canLaunch) {
    throw new AppError(422, "launch_blocked", readiness.blockers[0]?.message ?? "This test isn't ready to launch.");
  }
  await ctx.db.$transaction(async (tx) => {
    // Lock the study row so two concurrent launches can't each consume a credit.
    await tx.$queryRaw`SELECT id FROM studies WHERE id = ${study.id}::uuid FOR UPDATE`;
    const fresh = await tx.study.findUniqueOrThrow({ where: { id: study.id } });
    if (fresh.status === "active") return;
    let creditGrantId = fresh.creditGrantId;
    if (!creditGrantId) {
      // First launch consumes one credit — in this same transaction, so a failed launch consumes nothing.
      const grant = await consumeStudyCredit(tx, userId, fresh.participantLimit);
      creditGrantId = grant.id;
      await audit(tx, { actorUserId: userId, actorType: "user", action: "entitlement.credit_consumed", resourceType: "access_grant", resourceId: grant.id, metadata: { studyId: study.id } });
    }
    await tx.studyVersion.update({ where: { id: version.id }, data: { publishedAt: version.publishedAt ?? new Date() } });
    await tx.study.update({ where: { id: study.id }, data: { status: "active", creditGrantId, launchedAt: fresh.launchedAt ?? new Date() } });
    await audit(tx, { actorUserId: userId, actorType: "user", action: "study.launched", resourceType: "study", resourceId: study.id, metadata: { version: version.version } });
    if (!fresh.launchedAt) await recordConversion(tx, ctx.config, "study_launched", { userId });
  });
  return getStudyDetail(ctx, userId, study.id);
}

export async function setStudyLifecycle(ctx: AppContext, userId: string, studyId: string, action: "pause" | "resume" | "close") {
  const study = await getOwnedStudy(ctx, userId, studyId);
  const transitions: Record<typeof action, { from: string[]; to: "paused" | "active" | "closed" }> = {
    pause: { from: ["active", "full"], to: "paused" },
    resume: { from: ["paused"], to: "active" },
    close: { from: ["draft", "ready", "active", "paused", "full"], to: "closed" },
  };
  const t = transitions[action];
  if (!t.from.includes(study.status)) throw conflict("invalid_transition", `A ${study.status} test can't be ${action}d.`);
  if (action === "resume") {
    const version = await currentVersion(ctx, study);
    const readiness = await computeReadiness(ctx, { ...study, status: "paused" }, version);
    if (!readiness.canLaunch) throw new AppError(422, "launch_blocked", readiness.blockers[0]!.message);
  }
  const res = await ctx.db.study.updateMany({
    where: { id: study.id, status: study.status },
    data: { status: t.to, ...(t.to === "closed" ? { closedAt: new Date() } : {}) },
  });
  if (res.count !== 1) throw conflict("state_changed", "This test changed while you were editing. Refresh and try again.");
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: `study.${action}`, resourceType: "study", resourceId: study.id });
  return getStudyDetail(ctx, userId, study.id);
}

export async function deleteStudy(ctx: AppContext, userId: string, studyId: string) {
  const study = await getOwnedStudy(ctx, userId, studyId);
  const sessions = await ctx.db.studySession.count({ where: { studyId: study.id } });
  if (sessions > 0) throw conflict("has_participants", "Tests with participant results can't be deleted. Close it instead.");
  await ctx.db.study.delete({ where: { id: study.id } });
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "study.deleted", resourceType: "study", resourceId: study.id });
}

export function toVersionDto(v: StudyVersion): StudyVersionDto {
  return {
    version: v.version,
    task: v.task,
    startPath: v.startPath,
    startVerified: v.startVerified,
    goalType: v.goalType,
    goalTarget: v.goalTarget,
    goalPagePath: v.goalPagePath,
    goalVerified: v.goalVerified,
    timeLimitSeconds: v.timeLimitSeconds,
    milestones: (v.milestones ?? []) as StudyVersionDto["milestones"],
    repeatPolicy: v.repeatPolicy,
    publishedAt: v.publishedAt?.toISOString() ?? null,
  };
}

async function primaryParticipantCount(ctx: AppContext, studyId: string) {
  return ctx.db.studySession.count({ where: { studyId, isRepeat: false, status: { not: "invalid" } } });
}

export async function listStudies(ctx: AppContext, userId: string, projectId?: string): Promise<StudySummary[]> {
  const studies = await ctx.db.study.findMany({
    where: { project: { ownerId: userId }, ...(projectId ? { projectId } : {}) },
    include: { project: true },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(studies.map(async (s) => toSummary(ctx, s, await primaryParticipantCount(ctx, s.id))));
}

function toSummary(ctx: AppContext, s: StudyWithProject, participantCount: number): StudySummary {
  return {
    id: s.id,
    publicId: s.publicId,
    name: s.name,
    status: s.status,
    projectId: s.projectId,
    projectName: s.project.name,
    websiteUrl: s.project.websiteUrl,
    participantLimit: s.participantLimit,
    participantCount,
    createdAt: s.createdAt.toISOString(),
    launchedAt: s.launchedAt?.toISOString() ?? null,
  };
}

export async function getStudyDetail(ctx: AppContext, userId: string, studyId: string): Promise<StudyDetail> {
  const study = await getOwnedStudy(ctx, userId, studyId);
  const version = await currentVersion(ctx, study);
  const readiness = await computeReadiness(ctx, study, version);
  await syncDraftReady(ctx, study, readiness);
  const [versions, count, sessionCount] = await Promise.all([
    ctx.db.studyVersion.findMany({ where: { studyId: study.id }, select: { version: true }, orderBy: { version: "asc" } }),
    primaryParticipantCount(ctx, study.id),
    ctx.db.studySession.count({ where: { studyId: study.id } }),
  ]);
  return {
    ...toSummary(ctx, study, count),
    expiresAt: study.expiresAt?.toISOString() ?? null,
    currentVersion: toVersionDto(version),
    versions: versions.map((v) => v.version),
    shareUrl: shareUrl(ctx.config.appUrl, study.publicId),
    hasParticipants: sessionCount > 0,
    readiness,
  };
}
