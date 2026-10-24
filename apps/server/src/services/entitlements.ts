/**
 * Access model: an account has product access only through an AccessGrant
 * created by a VERIFIED payment or a valid invitation code. Each grant holds
 * study credits; one credit is consumed atomically when a study is first launched.
 * Accounts with only used-up grants keep access to their existing work.
 */
import type { Entitlement } from "@firstfive/shared";
import type { AccessGrant, Prisma, PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config";
import { AppError } from "../lib/errors";

type Tx = PrismaClient | Prisma.TransactionClient;

const activeWhere = (userId: string, now: Date): Prisma.AccessGrantWhereInput => ({
  userId,
  revokedAt: null,
  startsAt: { lte: now },
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

export async function activeGrants(db: Tx, userId: string, now = new Date()): Promise<AccessGrant[]> {
  return db.accessGrant.findMany({ where: activeWhere(userId, now), orderBy: { createdAt: "asc" } });
}

export async function getEntitlement(db: Tx, _config: AppConfig, userId: string, now = new Date()): Promise<Entitlement> {
  const grants = await activeGrants(db, userId, now);
  const [projects, studies, draftStudies] = await Promise.all([
    db.project.count({ where: { ownerId: userId } }),
    db.study.count({ where: { project: { ownerId: userId } } }),
    db.study.count({ where: { project: { ownerId: userId }, creditGrantId: null } }),
  ]);
  const usage = { projects, studies, draftStudies };
  if (grants.length === 0) {
    return {
      status: "none",
      planName: "No access yet",
      sources: [],
      studyCredits: 0,
      creditsUsed: 0,
      creditsAvailable: 0,
      maxProjects: 0,
      maxParticipantsPerStudy: 0,
      usage,
      expiresAt: null,
    };
  }
  const studyCredits = grants.reduce((n, g) => n + g.studyCredits, 0);
  const creditsUsed = grants.reduce((n, g) => n + g.creditsUsed, 0);
  const expiries = grants.map((g) => g.expiresAt).filter((d): d is Date => d != null);
  const sources = [...new Set(grants.map((g) => g.source))];
  return {
    status: "active",
    planName: sources.includes("payment") ? "One study (paid)" : "Complimentary access",
    sources,
    studyCredits,
    creditsUsed,
    creditsAvailable: Math.max(0, studyCredits - creditsUsed),
    // One website per study credit purchased or granted.
    maxProjects: Math.max(1, studyCredits),
    maxParticipantsPerStudy: Math.max(...grants.map((g) => g.maxParticipantsPerStudy)),
    usage,
    expiresAt: grants.some((g) => g.expiresAt == null) || expiries.length === 0 ? null : new Date(Math.max(...expiries.map((d) => d.getTime()))).toISOString(),
  };
}

export function noAccessError() {
  return new AppError(403, "no_entitlement", "Your account doesn't have First Five access yet. Get one study or redeem an invitation code.");
}

/** Required for every workspace endpoint: at least one (possibly used-up) grant. */
export async function assertHasAccess(db: Tx, userId: string) {
  const count = await db.accessGrant.count({ where: { userId, revokedAt: null } });
  if (count === 0) throw noAccessError();
}

export async function assertCanCreateProject(db: Tx, config: AppConfig, userId: string) {
  const e = await getEntitlement(db, config, userId);
  if (e.status === "none") throw noAccessError();
  if (e.usage.projects >= e.maxProjects) {
    throw new AppError(
      403,
      "entitlement_limit",
      `Your access includes ${e.maxProjects} website${e.maxProjects === 1 ? "" : "s"}. Get another study to add one more.`,
    );
  }
  return e;
}

export async function assertCanCreateStudy(db: Tx, config: AppConfig, userId: string) {
  const e = await getEntitlement(db, config, userId);
  if (e.status === "none") throw noAccessError();
  if (e.usage.draftStudies >= config.MAX_DRAFT_STUDIES) {
    throw new AppError(403, "entitlement_limit", "You have the maximum number of unlaunched drafts. Launch or delete one first.");
  }
  return e;
}

export function assertParticipantLimit(e: Entitlement, requested: number) {
  if (e.status === "none") throw noAccessError();
  if (requested > e.maxParticipantsPerStudy) {
    throw new AppError(400, "invalid_request", `Your access allows up to ${e.maxParticipantsPerStudy} participants per test.`, {
      participantLimit: `Up to ${e.maxParticipantsPerStudy} on your access`,
    });
  }
}

/**
 * Atomically consumes one study credit. The conditional UPDATE can only succeed
 * while credits remain, so concurrent launches cannot double-spend.
 * Must be called inside the launch transaction so a failed launch consumes nothing.
 */
export async function consumeStudyCredit(tx: Prisma.TransactionClient, userId: string, participantLimit: number): Promise<AccessGrant> {
  const candidates = (await activeGrants(tx, userId)).filter((g) => g.creditsUsed < g.studyCredits && g.maxParticipantsPerStudy >= participantLimit);
  for (const g of candidates) {
    const n = await tx.$executeRaw`
      UPDATE access_grants SET "creditsUsed" = "creditsUsed" + 1
       WHERE id = ${g.id}::uuid AND "creditsUsed" < "studyCredits" AND "revokedAt" IS NULL`;
    if (n === 1) return { ...g, creditsUsed: g.creditsUsed + 1 };
  }
  throw new AppError(
    403,
    "no_study_credits",
    "You don't have an unused study credit. Get another study or redeem an invitation code to launch this test.",
  );
}

export async function hasAvailableCredit(db: Tx, userId: string, participantLimit: number) {
  const grants = await activeGrants(db, userId);
  return grants.some((g) => g.creditsUsed < g.studyCredits && g.maxParticipantsPerStudy >= participantLimit);
}
