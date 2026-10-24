/**
 * Authoritative task-session lifecycle (PostgreSQL is the source of truth).
 *
 *   pending → completed   goal verified within the task window
 *   pending → dropped     explicit stop, finished without goal, or deadline
 *   pending → invalid     identifiable integrity/technical problem
 *   any     → invalid     participant withdrew consent
 *
 * Every transition is a conditional UPDATE … WHERE status = 'pending', so
 * concurrent goal/timeout/finish requests cannot both finalize.
 */
import type { AttemptState } from "@firstfive/shared";
import { CONSENT_TEXT_VERSION } from "@firstfive/shared";
import { HANDOFF_FRAGMENT_KEYS, SDK_LIMITS } from "@firstfive/sdk-contract";
import type { Prisma, StudySession } from "@prisma/client";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { publicId, randomToken, sha256 } from "../lib/crypto";
import { AppError, conflict, gone, notFound } from "../lib/errors";

export const LAUNCH_TICKET_TTL_MS = 10 * 60 * 1000;
export const FEEDBACK_TICKET_TTL_MS = 2 * 60 * 60 * 1000;
/** A live credential remains usable briefly after the deadline to flush events and end the task. */
export const LIVE_CREDENTIAL_GRACE_MS = 10 * 60 * 1000;
export const DEADLINE_GRACE_MS = SDK_LIMITS.deadlineGraceSeconds * 1000;

export const participantCookieName = (studyPublicId: string) => `ff_p_${studyPublicId}`;

export async function findInviteByToken(ctx: AppContext, studyId: string, token: string | undefined) {
  if (!token || token.length > 200) return null;
  return ctx.db.participantInvite.findFirst({ where: { tokenHash: sha256(token), studyId } });
}

export async function getPublicStudy(ctx: AppContext, studyPublicId: string) {
  const study = await ctx.db.study.findUnique({ where: { publicId: studyPublicId }, include: { project: true } });
  if (!study) throw notFound("Test");
  return study;
}

export function publicStudyStatus(study: { status: string; expiresAt: Date | null }) {
  if (study.expiresAt && study.expiresAt <= new Date()) return "expired" as const;
  switch (study.status) {
    case "active":
      return "open" as const;
    case "full":
      return "full" as const;
    case "paused":
      return "paused" as const;
    case "closed":
      return "closed" as const;
    case "expired":
      return "expired" as const;
    default:
      return "not_launched" as const;
  }
}

async function issueLaunchTicket(tx: Prisma.TransactionClient, session: StudySession, projectId: string, origin: string) {
  const ticket = randomToken();
  await tx.sdkTicket.create({
    data: {
      kind: "live_launch",
      tokenHash: sha256(ticket),
      projectId,
      studySessionId: session.id,
      allowedOrigin: origin,
      expiresAt: new Date(Math.min(Date.now() + LAUNCH_TICKET_TTL_MS, session.deadlineAt.getTime())),
    },
  });
  return ticket;
}

function launchUrlFor(websiteUrl: string, startPath: string, ticket: string) {
  const u = new URL(websiteUrl);
  u.pathname = startPath;
  u.search = "";
  u.hash = `${HANDOFF_FRAGMENT_KEYS.live}=${ticket}`;
  return u.href;
}

/** Poll until the session has stored an event with client_sequence >= target, or the timeout passes. */
export async function waitForSequence(ctx: AppContext, sessionId: string, target: number, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const top = await ctx.db.eventRecord.aggregate({ where: { studySessionId: sessionId }, _max: { clientSequence: true } });
    if ((top._max.clientSequence ?? 0) >= target) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function feedbackUrlFor(appUrl: string, studyPublicId: string, ticket: string) {
  return `${appUrl}/t/${studyPublicId}/feedback#h=${ticket}`;
}

export async function issueFeedbackTicket(ctx: AppContext | { db: Prisma.TransactionClient }, sessionId: string, projectId: string) {
  const ticket = randomToken();
  await ctx.db.sdkTicket.create({
    data: { kind: "feedback", tokenHash: sha256(ticket), projectId, studySessionId: sessionId, expiresAt: new Date(Date.now() + FEEDBACK_TICKET_TTL_MS) },
  });
  return ticket;
}

/**
 * Consenting participant starts (or resumes) an attempt.
 * Returns the participant-token cookie value when a new invite was created.
 */
export async function startAttempt(ctx: AppContext, studyPublicId: string, participantToken: string | undefined) {
  await reconcileExpired(ctx, { studyPublicId });
  const study = await getPublicStudy(ctx, studyPublicId);
  const status = publicStudyStatus(study);
  if (status === "expired") throw gone("study_expired", "This test has ended.");
  if (status === "closed") throw gone("study_closed", "This test is closed.");
  if (status === "paused") throw conflict("study_paused", "This test is paused. Please try again later.");
  if (status === "not_launched") throw notFound("Test");

  const version = await ctx.db.studyVersion.findUniqueOrThrow({ where: { studyId_version: { studyId: study.id, version: study.currentVersion } } });
  const invite = await findInviteByToken(ctx, study.id, participantToken);

  if (invite) {
    const existing = await ctx.db.studySession.findFirst({ where: { inviteId: invite.id }, orderBy: { startedAt: "desc" } });
    if (existing && existing.status === "pending" && existing.deadlineAt.getTime() > Date.now()) {
      // Browser refresh / revisit: same attempt. Issue a fresh launch ticket only if the website hasn't connected yet.
      const ticket = existing.launchExchangedAt
        ? null
        : await ctx.db.$transaction((tx) => issueLaunchTicket(tx, existing, study.projectId, study.project.canonicalOrigin));
      return { newToken: null, attempt: toAttemptState(ctx, study.publicId, existing, ticket ? launchUrlFor(study.project.websiteUrl, version.startPath, ticket) : null, null) };
    }
    if (existing && version.repeatPolicy === "block_repeats") {
      throw conflict("already_participated", "You've already taken this test. Thank you!");
    }
  }

  const now = new Date();
  const result = await ctx.db.$transaction(async (tx) => {
    // Serialize capacity checks for this study.
    await tx.$queryRaw`SELECT id FROM studies WHERE id = ${study.id}::uuid FOR UPDATE`;
    const fresh = await tx.study.findUniqueOrThrow({ where: { id: study.id } });
    if (fresh.status !== "active" && fresh.status !== "full") throw conflict("study_unavailable", "This test isn't accepting participants right now.");
    const isRepeat = Boolean(invite);
    if (!isRepeat) {
      const counted = await tx.studySession.count({ where: { studyId: study.id, isRepeat: false, status: { not: "invalid" } } });
      if (counted >= fresh.participantLimit) {
        if (fresh.status !== "full") await tx.study.update({ where: { id: study.id }, data: { status: "full" } });
        throw gone("study_full", "This test already has all the participants it needs. Thank you for your interest!");
      }
      if (fresh.status === "full") await tx.study.update({ where: { id: study.id }, data: { status: "active" } });
    }
    let token: string | null = null;
    let inviteId = invite?.id;
    if (!inviteId) {
      token = randomToken();
      const n = (await tx.participantInvite.count({ where: { studyId: study.id } })) + 1;
      const created = await tx.participantInvite.create({
        data: { studyId: study.id, participantKey: publicId("p", 16), label: `Participant ${n}`, tokenHash: sha256(token) },
      });
      inviteId = created.id;
    }
    const session = await tx.studySession.create({
      data: {
        publicId: publicId("ffx"),
        studyId: study.id,
        studyVersionId: version.id,
        inviteId,
        isRepeat,
        consentAt: now,
        consentTextVersion: CONSENT_TEXT_VERSION,
        startedAt: now,
        deadlineAt: new Date(now.getTime() + version.timeLimitSeconds * 1000),
      },
    });
    await tx.criticalEventReceipt.create({
      data: { studySessionId: session.id, kind: "session_started", occurredAt: now, verified: true },
    });
    const ticket = await issueLaunchTicket(tx, session, study.projectId, study.project.canonicalOrigin);
    if (!isRepeat) {
      const counted = await tx.studySession.count({ where: { studyId: study.id, isRepeat: false, status: { not: "invalid" } } });
      if (counted >= fresh.participantLimit) await tx.study.update({ where: { id: study.id }, data: { status: "full" } });
    }
    await audit(tx, { actorType: "participant", action: "session.started", resourceType: "study_session", resourceId: session.id, metadata: { isRepeat } });
    return { token, session, ticket };
  });
  return {
    newToken: result.token,
    attempt: toAttemptState(ctx, study.publicId, result.session, launchUrlFor(study.project.websiteUrl, version.startPath, result.ticket), null),
  };
}

export function toAttemptState(
  ctx: AppContext,
  studyPublicId: string,
  s: StudySession,
  launchUrl: string | null,
  feedbackTicket: string | null,
): AttemptState {
  return {
    sessionId: s.publicId,
    status: s.status,
    deadlineAt: s.deadlineAt.toISOString(),
    launchUrl,
    isRepeat: s.isRepeat,
    feedbackStatus: s.feedbackStatus,
    feedbackUrl: feedbackTicket ? feedbackUrlFor(ctx.config.appUrl, studyPublicId, feedbackTicket) : null,
  };
}

/** Participant's own view of their current attempt (identified by first-party cookie). */
export async function getAttemptForParticipant(ctx: AppContext, studyPublicId: string, token: string | undefined) {
  const study = await getPublicStudy(ctx, studyPublicId);
  const invite = await findInviteByToken(ctx, study.id, token);
  if (!invite) return null;
  await reconcileExpired(ctx, { studyId: study.id });
  const s = await ctx.db.studySession.findFirst({ where: { inviteId: invite.id }, orderBy: { startedAt: "desc" } });
  if (!s) return null;
  let feedbackTicket: string | null = null;
  if (s.status !== "pending" && s.status !== "invalid" && s.feedbackStatus === "awaiting") {
    feedbackTicket = await issueFeedbackTicket(ctx, s.id, study.projectId);
  }
  return toAttemptState(ctx, study.publicId, s, null, feedbackTicket);
}

export type EndReason = "finished" | "gave_up" | "consent_withdrawn";

/**
 * End a task. SDK contract: flush and await acknowledgement of all pending
 * events BEFORE calling end — the server decides the outcome from what it has.
 */
export async function endSession(ctx: AppContext, sessionId: string, reason: EndReason, actorType: "sdk" | "participant") {
  const now = new Date();
  const s = await ctx.db.studySession.findUniqueOrThrow({ where: { id: sessionId }, include: { study: true } });

  if (reason === "consent_withdrawn") {
    await ctx.db.$transaction(async (tx) => {
      await tx.studySession.update({
        where: { id: s.id },
        data: {
          status: "invalid",
          finalReason: "consent_withdrawn",
          finalizedAt: s.finalizedAt ?? now,
          feedbackStatus: "unavailable",
          dataQualityFlags: { set: [...new Set([...s.dataQualityFlags, "consent_withdrawn"])] },
        },
      });
      // Remove behavioral data and answers collected for this attempt.
      await tx.eventRecord.deleteMany({ where: { studySessionId: s.id } });
      await tx.interviewResponse.deleteMany({ where: { studySessionId: s.id } });
      await tx.outboxMessage.deleteMany({ where: { provider: "posthog", dedupeKey: { startsWith: `${s.publicId}:` } } });
      await tx.sdkCredential.updateMany({ where: { studySessionId: s.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.sdkTicket.updateMany({ where: { studySessionId: s.id, consumedAt: null }, data: { consumedAt: now } });
      await audit(tx, { actorType, action: "session.consent_withdrawn", resourceType: "study_session", resourceId: s.id });
    });
    return { status: "invalid" as const, finalReason: "consent_withdrawn", feedbackTicket: null };
  }

  if (s.status === "pending") {
    const pastDeadline = now.getTime() > s.deadlineAt.getTime() + DEADLINE_GRACE_MS;
    const finalReason = pastDeadline ? "deadline" : reason === "gave_up" ? "explicit_stop" : "finished_without_goal";
    await ctx.db.studySession.updateMany({
      where: { id: s.id, status: "pending" },
      data: { status: "dropped", finalReason, finalizedAt: now },
    });
  }
  const updated = await ctx.db.studySession.findUniqueOrThrow({ where: { id: s.id } });
  let feedbackTicket: string | null = null;
  if (updated.status === "completed" || updated.status === "dropped") {
    if (updated.feedbackStatus === "not_prompted" || updated.feedbackStatus === "unavailable") {
      await ctx.db.studySession.updateMany({ where: { id: s.id, feedbackStatus: { in: ["not_prompted", "unavailable"] } }, data: { feedbackStatus: "awaiting" } });
    }
    const current = await ctx.db.studySession.findUniqueOrThrow({ where: { id: s.id } });
    if (current.feedbackStatus === "awaiting") feedbackTicket = await issueFeedbackTicket(ctx, s.id, s.study.projectId);
  }
  await ctx.db.sdkCredential.updateMany({ where: { studySessionId: s.id, revokedAt: null }, data: { revokedAt: now } });
  await ctx.db.criticalEventReceipt.upsert({
    where: { studySessionId_kind: { studySessionId: s.id, kind: "session_finalized" } },
    create: { studySessionId: s.id, kind: "session_finalized", occurredAt: now, verified: true, detail: { requestedReason: reason, actorType } },
    update: {},
  });
  return { status: updated.status, finalReason: updated.finalReason, feedbackTicket };
}

export async function endAttemptForParticipant(ctx: AppContext, studyPublicId: string, token: string | undefined, reason: EndReason) {
  const study = await getPublicStudy(ctx, studyPublicId);
  const invite = await findInviteByToken(ctx, study.id, token);
  if (!invite) throw new AppError(401, "unauthenticated", "We couldn't find your test attempt in this browser.");
  const s = await ctx.db.studySession.findFirst({ where: { inviteId: invite.id }, orderBy: { startedAt: "desc" } });
  if (!s) throw notFound("Attempt");
  const result = await endSession(ctx, s.id, reason, "participant");
  const fresh = await ctx.db.studySession.findUniqueOrThrow({ where: { id: s.id } });
  return toAttemptState(ctx, study.publicId, fresh, null, result.feedbackTicket);
}

/**
 * Deadline reconciliation. Runs on a schedule AND on demand before reads, so
 * outcomes never depend on the browser sending a final event or on an
 * always-on worker.
 */
export async function reconcileExpired(ctx: AppContext, scope: { studyId?: string; studyPublicId?: string; sessionId?: string } = {}) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - DEADLINE_GRACE_MS);
  const studyFilter: Prisma.StudySessionWhereInput = scope.sessionId
    ? { id: scope.sessionId }
    : scope.studyId
      ? { studyId: scope.studyId }
      : scope.studyPublicId
        ? { study: { publicId: scope.studyPublicId } }
        : {};

  // Website never exchanged the launch ticket → no reliable observation was possible.
  const invalid = await ctx.db.studySession.updateMany({
    where: { ...studyFilter, status: "pending", deadlineAt: { lt: cutoff }, launchExchangedAt: null },
    data: { status: "invalid", finalReason: "launch_not_exchanged", finalizedAt: now, feedbackStatus: "unavailable", dataQualityFlags: { push: "no_sdk_handshake" } },
  });
  // Valid attempt reached the deadline without verified success.
  const dropped = await ctx.db.studySession.updateMany({
    where: { ...studyFilter, status: "pending", deadlineAt: { lt: cutoff }, launchExchangedAt: { not: null } },
    data: { status: "dropped", finalReason: "deadline", finalizedAt: now },
  });
  // Timed-out attempts whose participant never reached the interview.
  await ctx.db.studySession.updateMany({
    where: { ...studyFilter, status: { in: ["dropped", "completed"] }, feedbackStatus: "not_prompted", finalizedAt: { lt: new Date(now.getTime() - FEEDBACK_TICKET_TTL_MS) } },
    data: { feedbackStatus: "unavailable" },
  });
  await ctx.db.studySession.updateMany({
    where: { ...studyFilter, status: "dropped", finalReason: "deadline", feedbackStatus: "not_prompted" },
    data: { feedbackStatus: "unavailable" },
  });

  if (!scope.sessionId) {
    const studyWhere: Prisma.StudyWhereInput = scope.studyId ? { id: scope.studyId } : scope.studyPublicId ? { publicId: scope.studyPublicId } : {};
    await ctx.db.study.updateMany({
      where: { ...studyWhere, status: { in: ["draft", "ready", "active", "paused", "full"] }, expiresAt: { lt: now } },
      data: { status: "expired" },
    });
  }
  return { invalidated: invalid.count, dropped: dropped.count };
}
