import type { InvitationCodeDto } from "@firstfive/shared";
import { Prisma, type InvitationCode } from "@prisma/client";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { generateInvitationCode, hmacSha256, normalizeInvitationCode } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { getPlan } from "../plans";
import { recordActivationIfFirst, recordConversion } from "./conversions";

export function hashCode(secret: string, code: string): string {
  return hmacSha256(secret, `invitation-code:${normalizeInvitationCode(code)}`);
}

export interface GenerateCodesInput {
  label: string;
  audience: string;
  planKey: string;
  studyCredits?: number;
  participantCap?: number;
  count: number;
  maxRedemptions: number;
  expiresInDays?: number;
  grantDays?: number;
  createdById?: string | null;
}

/** Returns plaintext codes exactly once. Only HMAC verifiers are stored. */
export async function generateCodes(ctx: AppContext, input: GenerateCodesInput): Promise<{ codes: string[]; records: InvitationCodeDto[] }> {
  const plan = getPlan(ctx.config, input.planKey);
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
  const codes: string[] = [];
  const records: InvitationCode[] = [];
  for (let i = 0; i < input.count; i++) {
    const code = generateInvitationCode();
    const rec = await ctx.db.invitationCode.create({
      data: {
        codeHash: hashCode(ctx.config.SESSION_SECRET, code),
        codeHint: code.slice(-4),
        label: input.label,
        audience: input.audience,
        planKey: input.planKey,
        studyCredits: input.studyCredits ?? plan.studyCredits,
        participantCap: input.participantCap ?? plan.maxParticipantsPerStudy,
        maxRedemptions: input.maxRedemptions,
        grantDays: input.grantDays ?? null,
        expiresAt,
        createdById: input.createdById ?? null,
      },
    });
    codes.push(code);
    records.push(rec);
  }
  await audit(ctx.db, {
    actorUserId: input.createdById ?? null,
    actorType: input.createdById ? "admin" : "system",
    action: "invitation_codes.generated",
    resourceType: "invitation_code",
    metadata: { count: input.count, label: input.label, planKey: input.planKey, ids: records.map((r) => r.id) },
  });
  return { codes, records: records.map(toCodeDto) };
}

export function toCodeDto(c: InvitationCode): InvitationCodeDto {
  return {
    id: c.id,
    label: c.label,
    audience: c.audience,
    planKey: c.planKey,
    codeHint: c.codeHint,
    studyCredits: c.studyCredits,
    participantCap: c.participantCap,
    maxRedemptions: c.maxRedemptions,
    redemptionCount: c.redemptionCount,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    disabledAt: c.disabledAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

const INVALID = () => new AppError(400, "invalid_code", "This invitation code isn't valid.", { code: "This invitation code isn't valid" });

/** Read-only pre-check used before creating an account with a code. */
export async function checkCode(ctx: AppContext, code: string) {
  const rec = await ctx.db.invitationCode.findUnique({ where: { codeHash: hashCode(ctx.config.SESSION_SECRET, code) } });
  assertRedeemable(rec);
  return rec!;
}

function assertRedeemable(rec: InvitationCode | null, now = new Date()) {
  if (!rec) throw INVALID();
  if (rec.disabledAt) throw new AppError(410, "code_disabled", "This invitation code is no longer active.", { code: "No longer active" });
  if (rec.expiresAt && rec.expiresAt <= now) throw new AppError(410, "code_expired", "This invitation code has expired.", { code: "Expired" });
  if (rec.redemptionCount >= rec.maxRedemptions) {
    throw new AppError(410, "code_exhausted", "This invitation code has already been fully used.", { code: "Already fully used" });
  }
}

/**
 * Atomic redemption: the conditional UPDATE only succeeds while uses remain,
 * so concurrent requests cannot exceed the redemption limit.
 */
export async function redeemCode(ctx: AppContext, userId: string, code: string) {
  const codeHash = hashCode(ctx.config.SESSION_SECRET, code);
  const rec = await ctx.db.invitationCode.findUnique({ where: { codeHash } });
  // Tell the user they already have this code's access before reporting it as used up.
  if (rec && (await ctx.db.invitationCodeRedemption.findUnique({ where: { codeId_userId: { codeId: rec.id, userId } } }))) {
    throw new AppError(409, "already_redeemed", "You've already redeemed this code — its access is already on your account.", { code: "Already redeemed on your account" });
  }
  assertRedeemable(rec);
  const plan = getPlan(ctx.config, rec!.planKey);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const already = await tx.invitationCodeRedemption.findUnique({ where: { codeId_userId: { codeId: rec!.id, userId } } });
      if (already) throw new AppError(409, "already_redeemed", "You've already redeemed this code.", { code: "Already redeemed on your account" });
      const updated = await tx.$executeRaw`
        UPDATE invitation_codes
           SET "redemptionCount" = "redemptionCount" + 1
         WHERE id = ${rec!.id}::uuid
           AND "disabledAt" IS NULL
           AND ("expiresAt" IS NULL OR "expiresAt" > now())
           AND "redemptionCount" < "maxRedemptions"`;
      if (updated !== 1) {
        throw new AppError(410, "code_exhausted", "This invitation code has already been fully used.", { code: "Already fully used" });
      }
      const redemption = await tx.invitationCodeRedemption.create({ data: { codeId: rec!.id, userId } });
      const grant = await tx.accessGrant.create({
        data: {
          userId,
          planKey: plan.key,
          source: "invitation_code",
          studyCredits: rec!.studyCredits,
          maxParticipantsPerStudy: rec!.participantCap,
          expiresAt: rec!.grantDays ? new Date(Date.now() + rec!.grantDays * 86_400_000) : null,
          redemptionId: redemption.id,
        },
      });
      await audit(tx, {
        actorUserId: userId,
        actorType: "user",
        action: "invitation_code.redeemed",
        resourceType: "invitation_code",
        resourceId: rec!.id,
        metadata: { planKey: plan.key, grantId: grant.id, studyCredits: rec!.studyCredits },
      });
      await recordConversion(tx, ctx.config, "invitation_code_redeemed", { userId, properties: { audience: rec!.audience } });
      await recordActivationIfFirst(tx, ctx.config, userId, "invitation_code");
      return { planKey: plan.key, planName: plan.name, grantId: grant.id, studyCredits: rec!.studyCredits };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "already_redeemed", "You've already redeemed this code.", { code: "Already redeemed on your account" });
    }
    throw err;
  }
}

export async function disableCode(ctx: AppContext, adminId: string, id: string) {
  const rec = await ctx.db.invitationCode.update({ where: { id }, data: { disabledAt: new Date() } });
  await audit(ctx.db, { actorUserId: adminId, actorType: "admin", action: "invitation_code.disabled", resourceType: "invitation_code", resourceId: id });
  return toCodeDto(rec);
}
