/**
 * Render-side implementation of the SDK contract (packages/sdk-contract).
 * The SDK itself is a separate project; this file only serves its API.
 */
import {
  EventBatchRequestSchema,
  ExchangeRequestSchema,
  SDK_CONTRACT_VERSION,
  SDK_EVENT_NAMES,
  SDK_LIMITS,
  SETUP_ONLY_EVENTS,
  SdkEventSchema,
  type EventBatchResponse,
  type EventRejectionCode,
  type ExchangeResponse,
  type SdkConfigResponse,
  type SdkEvent,
  type SessionStateResponse,
} from "@firstfive/sdk-contract";
import type { Prisma, Project, SdkCredential, StudySession, StudyVersion } from "@prisma/client";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { pathsEqual, sanitizeLabel, sanitizePath } from "../lib/url";
import { mapToPostHogEvent } from "../integrations/posthog";
import { DEADLINE_GRACE_MS, LIVE_CREDENTIAL_GRACE_MS, reconcileExpired } from "./sessions";

const sdkError = (status: number, code: string, message: string) => new AppError(status, code, message);

export async function isRegisteredOrigin(ctx: AppContext, origin: string): Promise<boolean> {
  return (await ctx.db.projectOrigin.count({ where: { origin } })) > 0;
}

async function projectAllowsOrigin(ctx: AppContext, projectId: string, origin: string | undefined) {
  if (!origin) return false;
  return (await ctx.db.projectOrigin.count({ where: { projectId, origin } })) > 0;
}

/** Records a rejected request from an unregistered origin (rate-limited to one write per minute). */
async function recordIssue(ctx: AppContext, project: Project, issue: string) {
  if (project.lastIssueAt && Date.now() - project.lastIssueAt.getTime() < 60_000) return;
  await ctx.db.project.update({
    where: { id: project.id },
    data: {
      lastIssue: issue.slice(0, 300),
      lastIssueAt: new Date(),
      ...(project.integrationStatus === "connected" ? {} : { integrationStatus: "connection_issue" }),
    },
  });
}

// ───────────────────────────── Config ─────────────────────────────

export async function getSdkConfig(ctx: AppContext, projectPublicId: string, origin: string | undefined, sdkVersion?: string) {
  const project = await ctx.db.project.findUnique({ where: { publicId: projectPublicId }, include: { origins: true, sdkConfig: true } });
  if (!project) throw sdkError(404, "not_found", "Unknown project.");
  const allowed = project.origins.map((o) => o.origin);
  const originAllowed = origin != null && allowed.includes(origin);
  if (origin && !originAllowed) {
    await recordIssue(ctx, project, `Received a request from ${origin}, which isn't one of this website's registered addresses.`);
    throw sdkError(403, "origin_not_allowed", "This origin isn't registered for the project.");
  }
  if (originAllowed) {
    // An installation ping proves the script loaded on an allowed page; it is NOT a verified connection.
    await ctx.db.project.update({
      where: { id: project.id },
      data: {
        lastConfigPingAt: new Date(),
        lastSdkVersion: sdkVersion?.slice(0, 40) ?? project.lastSdkVersion,
        ...(project.integrationStatus === "setup_not_started" || project.integrationStatus === "awaiting_connection"
          ? { integrationStatus: "verification_needed" }
          : {}),
      },
    });
  }
  const body: SdkConfigResponse = {
    project_id: project.publicId,
    status: "active",
    contract_version: SDK_CONTRACT_VERSION,
    api_base_url: ctx.config.appUrl,
    allowed_origins: allowed,
    event_allowlist: SDK_EVENT_NAMES,
    allowed_custom_events: project.sdkConfig?.allowedCustomEvents ?? [],
    limits: SDK_LIMITS,
  };
  return { body, allowOrigin: originAllowed ? origin! : null };
}

// ───────────────────────────── Exchange ─────────────────────────────

export async function exchangeTicket(ctx: AppContext, raw: unknown, origin: string | undefined): Promise<ExchangeResponse> {
  const parsed = ExchangeRequestSchema.safeParse(raw);
  if (!parsed.success) throw sdkError(400, "invalid_request", "project_id and ticket are required.");
  const { project_id, ticket, sdk_version } = parsed.data;
  const project = await ctx.db.project.findUnique({ where: { publicId: project_id } });
  if (!project) throw sdkError(404, "not_found", "Unknown project.");
  if (!(await projectAllowsOrigin(ctx, project.id, origin))) {
    await recordIssue(ctx, project, `A test link was opened on ${origin ?? "an unknown origin"}, which isn't registered for this website.`);
    throw sdkError(403, "origin_not_allowed", "This origin isn't registered for the project.");
  }
  const t = await ctx.db.sdkTicket.findUnique({ where: { tokenHash: sha256(ticket) } });
  if (!t || t.projectId !== project.id || t.kind === "feedback") throw sdkError(404, "not_found", "Unknown ticket.");
  if (t.consumedAt) throw sdkError(410, "ticket_consumed", "This link has already been used.");
  if (t.expiresAt <= new Date()) throw sdkError(410, "ticket_expired", "This link has expired.");
  if (t.allowedOrigin && t.allowedOrigin !== origin && !(await projectAllowsOrigin(ctx, project.id, origin))) {
    throw sdkError(403, "origin_not_allowed", "This ticket isn't valid on this origin.");
  }
  // One-time use: only the request that flips consumedAt wins.
  const consumed = await ctx.db.sdkTicket.updateMany({
    where: { id: t.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw sdkError(410, "ticket_consumed", "This link has already been used.");

  const credential = randomToken();
  if (t.kind === "setup_launch") {
    const setup = await ctx.db.setupSession.findUnique({ where: { id: t.setupSessionId! } });
    if (!setup || setup.status !== "active" || setup.expiresAt <= new Date()) throw sdkError(410, "session_expired", "This setup session has ended.");
    await ctx.db.sdkCredential.create({
      data: { tokenHash: sha256(credential), mode: "setup", projectId: project.id, setupSessionId: setup.id, origin: origin!, expiresAt: setup.expiresAt },
    });
    if (sdk_version) await ctx.db.project.update({ where: { id: project.id }, data: { lastSdkVersion: sdk_version.slice(0, 40) } });
    return {
      credential,
      mode: "setup",
      expires_at: setup.expiresAt.toISOString(),
      project_id: project.publicId,
      setup: { setup_session_id: setup.id, expires_at: setup.expiresAt.toISOString() },
    };
  }

  // live_launch
  const session = await ctx.db.studySession.findUnique({ where: { id: t.studySessionId! }, include: { study: true, studyVersion: true } });
  if (!session) throw sdkError(404, "not_found", "Unknown session.");
  if (session.status !== "pending" || session.deadlineAt <= new Date()) throw sdkError(410, "session_expired", "This test attempt has ended.");
  const expiresAt = new Date(session.deadlineAt.getTime() + LIVE_CREDENTIAL_GRACE_MS);
  await ctx.db.$transaction([
    ctx.db.sdkCredential.create({
      data: { tokenHash: sha256(credential), mode: "live", projectId: project.id, studySessionId: session.id, origin: origin!, expiresAt },
    }),
    ctx.db.studySession.update({ where: { id: session.id }, data: { launchExchangedAt: session.launchExchangedAt ?? new Date() } }),
    ctx.db.criticalEventReceipt.upsert({
      where: { studySessionId_kind: { studySessionId: session.id, kind: "launch_exchanged" } },
      create: { studySessionId: session.id, kind: "launch_exchanged", occurredAt: new Date(), verified: true, detail: { origin } },
      update: {},
    }),
  ]);
  return {
    credential,
    mode: "live",
    expires_at: expiresAt.toISOString(),
    project_id: project.publicId,
    study: {
      study_id: session.study.publicId,
      session_id: session.publicId,
      task: session.studyVersion.task,
      deadline_at: session.deadlineAt.toISOString(),
      goal_type: session.studyVersion.goalType,
    },
  };
}

// ───────────────────────────── Credentials ─────────────────────────────

export interface ResolvedCredential {
  credential: SdkCredential;
  project: Project;
  session: (StudySession & { studyVersion: StudyVersion; study: { publicId: string; projectId: string } }) | null;
}

export async function resolveCredential(ctx: AppContext, authorization: string | undefined, origin: string | undefined): Promise<ResolvedCredential> {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
  if (!token || token.length > 200) throw sdkError(401, "unauthenticated", "Missing SDK credential.");
  const credential = await ctx.db.sdkCredential.findUnique({ where: { tokenHash: sha256(token) }, include: { project: true } });
  if (!credential) throw sdkError(401, "unauthenticated", "Invalid SDK credential.");
  if (credential.revokedAt || credential.expiresAt <= new Date()) throw sdkError(410, "session_expired", "This SDK session has ended.");
  if (origin && origin !== credential.origin && !(await projectAllowsOrigin(ctx, credential.projectId, origin))) {
    throw sdkError(403, "origin_not_allowed", "This credential isn't valid on this origin.");
  }
  let session: ResolvedCredential["session"] = null;
  if (credential.mode === "live") {
    session = await ctx.db.studySession.findUnique({
      where: { id: credential.studySessionId! },
      include: { studyVersion: true, study: { select: { publicId: true, projectId: true } } },
    });
    if (!session) throw sdkError(401, "unauthenticated", "Invalid SDK credential.");
  }
  return { credential, project: credential.project, session };
}

export async function getSessionState(ctx: AppContext, r: ResolvedCredential): Promise<SessionStateResponse> {
  if (r.credential.mode === "setup") {
    const setup = await ctx.db.setupSession.findUniqueOrThrow({ where: { id: r.credential.setupSessionId! } });
    const status = setup.status === "active" && setup.expiresAt <= new Date() ? "expired" : setup.status;
    return { mode: "setup", project_id: r.project.publicId, expires_at: r.credential.expiresAt.toISOString(), setup: { setup_session_id: setup.id, status } };
  }
  await reconcileExpired(ctx, { sessionId: r.session!.id });
  const s = await ctx.db.studySession.findUniqueOrThrow({ where: { id: r.session!.id } });
  return {
    mode: "live",
    project_id: r.project.publicId,
    expires_at: r.credential.expiresAt.toISOString(),
    study: {
      study_id: r.session!.study.publicId,
      session_id: s.publicId,
      task: r.session!.studyVersion.task,
      deadline_at: s.deadlineAt.toISOString(),
      goal_type: r.session!.studyVersion.goalType,
      status: s.status,
      goal_verified: s.status === "completed" && s.goalVerifiedAt != null,
      server_time: new Date().toISOString(),
    },
  };
}

export async function finishSetup(ctx: AppContext, r: ResolvedCredential) {
  if (r.credential.mode !== "setup") throw sdkError(403, "credential_scope", "Not a setup credential.");
  await ctx.db.setupSession.updateMany({ where: { id: r.credential.setupSessionId!, status: "active" }, data: { status: "finished", endedAt: new Date() } });
  await ctx.db.sdkCredential.update({ where: { id: r.credential.id }, data: { revokedAt: new Date() } });
  return { status: "finished" as const, return_url: `${ctx.config.appUrl}/app/websites/${r.project.id}/journey` };
}

// ───────────────────────────── Events ─────────────────────────────

interface NormalizedEvent {
  raw: SdkEvent;
  pagePath: string | null;
  label: string | null;
  timestamp: Date;
}

export function goalMatches(e: NormalizedEvent, v: Pick<StudyVersion, "goalType" | "goalTarget" | "goalPagePath">): boolean {
  switch (v.goalType) {
    case "page_reached":
      return e.raw.event_name === "ff_page_viewed" && pathsEqual(e.pagePath, v.goalTarget);
    case "element_clicked":
      return e.raw.event_name === "ff_element_clicked" && e.raw.element_id === v.goalTarget && (!v.goalPagePath || pathsEqual(e.pagePath, v.goalPagePath));
    case "custom_event":
      return e.raw.event_name === "ff_custom_event" && e.raw.custom_event_name === v.goalTarget;
  }
}

export async function ingestEvents(ctx: AppContext, r: ResolvedCredential, raw: unknown): Promise<EventBatchResponse> {
  const batch = EventBatchRequestSchema.safeParse(raw);
  if (!batch.success) throw sdkError(400, "invalid_request", `Invalid batch: ${batch.error.issues[0]?.message ?? "schema error"}`);
  const now = new Date();
  const mode = r.credential.mode;
  const rejected: EventBatchResponse["rejected"] = [];
  const valid: NormalizedEvent[] = [];
  const reject = (event_id: string | null, code: EventRejectionCode, message: string) => rejected.push({ event_id, code, message });
  const seenInBatch = new Set<string>();
  const inBatchDuplicates: string[] = [];

  const config = await ctx.db.projectSdkConfig.findUnique({ where: { projectId: r.project.id } });
  const session = r.session;
  if (session) await reconcileExpired(ctx, { sessionId: session.id });
  const currentSession = session ? await ctx.db.studySession.findUniqueOrThrow({ where: { id: session.id } }) : null;

  for (const item of batch.data.events) {
    const parsed = SdkEventSchema.safeParse(item);
    const eventId = typeof (item as { event_id?: unknown })?.event_id === "string" ? String((item as { event_id: string }).event_id).slice(0, 64) : null;
    if (!parsed.success) {
      reject(eventId, "invalid_schema", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300));
      continue;
    }
    const e = parsed.data;
    if (seenInBatch.has(e.event_id)) {
      inBatchDuplicates.push(e.event_id);
      continue;
    }
    seenInBatch.add(e.event_id);
    if (e.project_id !== r.project.publicId) {
      reject(e.event_id, "wrong_project", "project_id doesn't match the credential.");
      continue;
    }
    if (e.mode !== mode) {
      reject(e.event_id, "wrong_mode", `Event mode must be "${mode}" for this credential.`);
      continue;
    }
    if (mode === "setup" && (e.study_id || e.session_id)) {
      reject(e.event_id, "wrong_mode", "Setup events must not carry study_id or session_id.");
      continue;
    }
    if (mode === "live") {
      if (SETUP_ONLY_EVENTS.includes(e.event_name)) {
        reject(e.event_id, "setup_only_event", `${e.event_name} is only accepted during setup.`);
        continue;
      }
      if (e.study_id !== session!.study.publicId) {
        reject(e.event_id, "wrong_study", "study_id doesn't match the credential.");
        continue;
      }
      if (e.session_id !== session!.publicId) {
        reject(e.event_id, "wrong_session", "session_id doesn't match the credential.");
        continue;
      }
    }
    if (e.event_name === "ff_custom_event") {
      if (!e.custom_event_name) {
        reject(e.event_id, "invalid_schema", "custom_event_name is required for ff_custom_event.");
        continue;
      }
      const allow = config?.allowedCustomEvents ?? [];
      if (allow.length > 0 && !allow.includes(e.custom_event_name)) {
        reject(e.event_id, "custom_event_not_allowed", "This custom event isn't on the project's allowlist.");
        continue;
      }
    }
    const ts = new Date(e.timestamp);
    const skewMs = SDK_LIMITS.maxClockSkewSeconds * 1000;
    if (ts.getTime() > now.getTime() + skewMs) {
      reject(e.event_id, "clock_skew", "Event timestamp is too far in the future.");
      continue;
    }
    if (mode === "live" && currentSession) {
      if (ts.getTime() < currentSession.startedAt.getTime() - skewMs) {
        reject(e.event_id, "clock_skew", "Event timestamp is before the task started.");
        continue;
      }
      const windowEnd = (currentSession.status === "pending" ? currentSession.deadlineAt : (currentSession.finalizedAt ?? currentSession.deadlineAt)).getTime() + DEADLINE_GRACE_MS;
      if (currentSession.status === "invalid") {
        reject(e.event_id, "session_finalized", "This attempt has been excluded.");
        continue;
      }
      if (ts.getTime() > windowEnd) {
        reject(e.event_id, currentSession.status === "pending" ? "after_deadline" : "session_finalized", "Event occurred after the task window.");
        continue;
      }
    }
    valid.push({
      raw: e,
      pagePath: e.page_path ? sanitizePath(e.page_path) : null,
      label: sanitizeLabel(e.element_label, SDK_LIMITS.maxLabelLength),
      timestamp: ts,
    });
  }

  const purgeAfter = new Date(now.getTime() + ctx.config.EVENT_RETENTION_DAYS * 86_400_000);
  const rows: Prisma.EventRecordCreateManyInput[] = valid.map((v) => ({
    eventId: v.raw.event_id,
    projectId: r.project.id,
    mode,
    setupSessionId: r.credential.setupSessionId,
    studySessionId: session?.id ?? null,
    eventName: v.raw.event_name,
    clientSequence: v.raw.client_sequence,
    clientTimestamp: v.timestamp,
    receivedAt: now,
    pagePath: v.pagePath,
    elementKey: v.raw.element_id ?? null,
    elementType: v.raw.element_type ?? null,
    elementLabel: v.label,
    properties: {
      ...(v.raw.properties ?? {}),
      ...(v.raw.custom_event_name ? { custom_event_name: v.raw.custom_event_name } : {}),
    } as Prisma.InputJsonValue,
    purgeAfter,
  }));

  const result = await ctx.db.$transaction(async (tx) => {
    const inserted = rows.length ? await tx.eventRecord.createManyAndReturn({ data: rows, skipDuplicates: true, select: { eventId: true } }) : [];
    const insertedIds = new Set(inserted.map((i) => i.eventId));
    const accepted = valid.filter((v) => insertedIds.has(v.raw.event_id));
    const duplicates = [...valid.filter((v) => !insertedIds.has(v.raw.event_id)).map((v) => v.raw.event_id), ...inBatchDuplicates];

    if (accepted.length > 0) {
      if (mode === "setup") await applyDiscovery(tx, r, accepted, now);
      await tx.project.update({
        where: { id: r.project.id },
        data: {
          lastActivityAt: now,
          lastSdkVersion: batch.data.sdk_version?.slice(0, 40) ?? undefined,
          ...(mode === "setup"
            ? { integrationStatus: "connected", firstConnectedAt: r.project.firstConnectedAt ?? now, lastIssue: null, lastIssueAt: null }
            : {}),
        },
      });
      if (mode === "setup") {
        await tx.projectOrigin.updateMany({ where: { projectId: r.project.id, origin: r.credential.origin }, data: { verifiedAt: now } });
        await tx.setupSession.update({ where: { id: r.credential.setupSessionId! }, data: { eventCount: { increment: accepted.length } } });
      }
      if (session) await tx.studySession.update({ where: { id: session.id }, data: { lastEventAt: now } });
      if (ctx.providers.analytics.configured) await enqueueAnalytics(tx, ctx, r, accepted, now);
    }

    let goal: EventBatchResponse["goal"] = null;
    let sessionStatus: EventBatchResponse["session_status"] = null;
    if (session && currentSession) {
      const candidates = accepted
        .filter((a) => goalMatches(a, session.studyVersion))
        .sort((a, b) => a.raw.client_sequence - b.raw.client_sequence || a.timestamp.getTime() - b.timestamp.getTime());
      const goalEvent = candidates[0];
      if (goalEvent && currentSession.status === "pending") {
        const inWindow =
          goalEvent.timestamp.getTime() <= currentSession.deadlineAt.getTime() && now.getTime() <= currentSession.deadlineAt.getTime() + DEADLINE_GRACE_MS;
        if (inWindow) {
          const goalAt = new Date(Math.min(Math.max(goalEvent.timestamp.getTime(), currentSession.startedAt.getTime()), now.getTime()));
          const won = await tx.studySession.updateMany({
            where: { id: session.id, status: "pending" },
            data: { status: "completed", goalVerifiedAt: goalAt, verifiedGoalEventId: goalEvent.raw.event_id, finalReason: "goal_verified", finalizedAt: now },
          });
          if (won.count === 1) {
            await tx.criticalEventReceipt.create({
              data: { studySessionId: session.id, kind: "goal_verified", eventId: goalEvent.raw.event_id, occurredAt: goalAt, verified: true },
            });
          }
        } else {
          await tx.studySession.update({
            where: { id: session.id },
            data: { dataQualityFlags: { set: [...new Set([...currentSession.dataQualityFlags, "late_goal_event"])] } },
          });
        }
      }
      const after = await tx.studySession.findUniqueOrThrow({ where: { id: session.id } });
      goal = { verified: after.status === "completed", verified_event_id: after.verifiedGoalEventId };
      sessionStatus = after.status;
    }
    return { accepted: accepted.map((a) => a.raw.event_id), duplicates, goal, sessionStatus };
  });

  return { accepted: result.accepted, duplicates: result.duplicates, rejected, goal: result.goal, session_status: result.sessionStatus };
}

async function applyDiscovery(tx: Prisma.TransactionClient, r: ResolvedCredential, events: NormalizedEvent[], now: Date) {
  const projectId = r.project.id;
  const setupSessionId = r.credential.setupSessionId;
  for (const e of events) {
    const name = e.raw.event_name;
    // Any setup event proves its page was actually visited.
    if (name !== "ff_page_viewed" && e.pagePath) {
      await tx.discoveredPage.upsert({
        where: { projectId_path: { projectId, path: e.pagePath } },
        create: { projectId, path: e.pagePath, viewCount: 0, lastSetupSessionId: setupSessionId },
        update: { lastSeenAt: now },
      });
    }
    if (name === "ff_page_viewed" && e.pagePath) {
      await tx.discoveredPage.upsert({
        where: { projectId_path: { projectId, path: e.pagePath } },
        create: { projectId, path: e.pagePath, viewCount: 1, lastSetupSessionId: setupSessionId },
        update: { viewCount: { increment: 1 }, lastSeenAt: now, lastSetupSessionId: setupSessionId },
      });
    } else if ((name === "ff_element_discovered" || name === "ff_element_clicked" || name === "ff_form_submitted") && e.raw.element_id && e.pagePath) {
      const clicked = name !== "ff_element_discovered";
      await tx.discoveredElement.upsert({
        where: { projectId_pagePath_elementKey: { projectId, pagePath: e.pagePath, elementKey: e.raw.element_id } },
        create: {
          projectId,
          pagePath: e.pagePath,
          elementKey: e.raw.element_id,
          elementType: e.raw.element_type ?? (name === "ff_form_submitted" ? "form" : "other"),
          safeLabel: e.label,
          wasClicked: clicked,
          lastSetupSessionId: setupSessionId,
        },
        update: { lastSeenAt: now, safeLabel: e.label ?? undefined, lastSetupSessionId: setupSessionId, ...(clicked ? { wasClicked: true } : {}) },
      });
    } else if (name === "ff_custom_event" && e.raw.custom_event_name) {
      await tx.discoveredCustomEvent.upsert({
        where: { projectId_eventName: { projectId, eventName: e.raw.custom_event_name } },
        create: { projectId, eventName: e.raw.custom_event_name },
        update: { lastSeenAt: now },
      });
    }
  }
}

async function enqueueAnalytics(tx: Prisma.TransactionClient, ctx: AppContext, r: ResolvedCredential, events: NormalizedEvent[], now: Date) {
  let distinctId = `setup_${r.credential.setupSessionId}`;
  if (r.session) {
    const invite = await tx.participantInvite.findUniqueOrThrow({ where: { id: r.session.inviteId } });
    distinctId = invite.participantKey;
  }
  const purgeAfter = new Date(now.getTime() + ctx.config.OUTBOX_RETENTION_DAYS * 86_400_000);
  await tx.outboxMessage.createMany({
    skipDuplicates: true,
    data: events.map((e) => ({
      provider: "posthog",
      dedupeKey: `${r.session?.publicId ?? "setup"}:${e.raw.event_id}`,
      purgeAfter,
      payload: mapToPostHogEvent({
        eventId: e.raw.event_id,
        eventName: e.raw.event_name,
        distinctId,
        timestamp: e.timestamp.toISOString(),
        projectPublicId: r.project.publicId,
        studyPublicId: r.session?.study.publicId ?? null,
        studyVersion: r.session?.studyVersion.version ?? null,
        sessionPublicId: r.session?.publicId ?? null,
        mode: r.credential.mode,
        clientSequence: e.raw.client_sequence,
        pagePath: e.pagePath,
        elementKey: e.raw.element_id ?? null,
        elementType: e.raw.element_type ?? null,
        elementLabel: e.label,
        customEventName: e.raw.custom_event_name ?? null,
      }) as unknown as Prisma.InputJsonValue,
    })),
  });
}

export async function auditSdk(ctx: AppContext, action: string, resourceId: string, metadata?: Prisma.InputJsonValue) {
  await audit(ctx.db, { actorType: "sdk", action, resourceType: "project", resourceId, metadata });
}
