/**
 * Direct UPI payments with MANUAL confirmation.
 *
 * A plain UPI ID offers no server-side confirmation, so:
 *   buyer opens checkout → order with a unique reference + UPI QR/deep link →
 *   buyer pays and submits the 12-digit UTR → order "pending_verification" →
 *   an admin checks their UPI/bank app and confirms → payment verified → study credit granted.
 * Nothing is granted on the buyer's claim alone.
 */
import type { AdminPaymentDto, UpiPaymentInstructions } from "@firstfive/shared";
import { Prisma, type Order } from "@prisma/client";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { AppError, conflict, notFound } from "../lib/errors";
import { recordConversion } from "./conversions";
import { grantPaidAccess, priceLabel } from "./payments";

export const UPI_PROVIDER = "upi_manual";
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function newReference() {
  let s = "FF";
  for (let i = 0; i < 8; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return s;
}

export function upiInstructions(ctx: AppContext, order: Pick<Order, "amountMinor" | "currency" | "merchantReference">): UpiPaymentInstructions {
  const vpa = ctx.config.UPI_PAYEE_VPA!;
  const amount = (order.amountMinor / 100).toFixed(2);
  const params = new URLSearchParams({
    pa: vpa,
    pn: ctx.config.UPI_PAYEE_NAME,
    am: amount,
    cu: order.currency,
    tn: `First Five ${order.merchantReference}`,
  });
  return {
    payeeVpa: vpa,
    payeeName: ctx.config.UPI_PAYEE_NAME,
    amount,
    amountLabel: priceLabel(order.amountMinor, order.currency),
    reference: order.merchantReference,
    uri: `upi://pay?${params.toString().replace(/\+/g, "%20")}`,
  };
}

export async function createUpiCheckout(ctx: AppContext, userId: string, planKey: string) {
  // Reuse a recent unpaid UPI order so repeated clicks don't pile up references.
  const recent = await ctx.db.order.findFirst({
    where: { userId, provider: UPI_PROVIDER, status: "checkout_ready", createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) return { orderId: recent.id, redirectUrl: `${ctx.config.appUrl}/payment/status?order=${recent.id}` };
  let order: Order | null = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    try {
      order = await ctx.db.order.create({
        data: {
          userId,
          planKey,
          provider: UPI_PROVIDER,
          amountMinor: ctx.config.PAID_STUDY_PRICE_MINOR,
          currency: ctx.config.PAID_STUDY_CURRENCY,
          environment: "live",
          merchantReference: newReference(),
          status: "checkout_ready",
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  if (!order) throw new AppError(500, "internal_error", "Couldn't create a payment reference. Please try again.");
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "order.upi_checkout_created", resourceType: "order", resourceId: order.id });
  await recordConversion(ctx.db, ctx.config, "checkout_started", { userId, properties: { environment: "live", method: UPI_PROVIDER } });
  return { orderId: order.id, redirectUrl: `${ctx.config.appUrl}/payment/status?order=${order.id}` };
}

export const UtrSchema = z.object({
  utr: z
    .string()
    .trim()
    .regex(/^\d{12}$/, "Enter the 12-digit UPI transaction ID (UTR) from your UPI app"),
});

/** Buyer submits the UPI transaction ID. This is a claim, not proof: it only queues the order for manual review. */
export async function submitUtr(ctx: AppContext, userId: string, orderId: string, raw: unknown) {
  const { utr } = UtrSchema.parse(raw);
  const order = await ctx.db.order.findFirst({ where: { id: orderId, userId } });
  if (!order || order.provider !== UPI_PROVIDER) throw notFound("Order");
  if (!["checkout_ready", "pending_verification"].includes(order.status)) {
    throw conflict("order_closed", "This payment has already been reviewed.");
  }
  const key = `upi:${utr}`;
  const used = await ctx.db.payment.findUnique({ where: { providerPaymentId: key } });
  if (used && used.orderId !== order.id) {
    throw new AppError(409, "utr_already_used", "That transaction ID has already been submitted for another order.", { utr: "Already used" });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { orderId: order.id, verified: false } });
    await tx.payment.create({ data: { orderId: order.id, providerPaymentId: key, providerStatus: "submitted_by_buyer", verified: false } });
    await tx.order.update({ where: { id: order.id }, data: { status: "pending_verification" } });
  });
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "order.upi_utr_submitted", resourceType: "order", resourceId: order.id });
}

export async function listPaymentsForAdmin(ctx: AppContext): Promise<AdminPaymentDto[]> {
  const orders = await ctx.db.order.findMany({
    where: { provider: UPI_PROVIDER, status: { in: ["checkout_ready", "pending_verification", "paid_verified", "failed"] } },
    include: { user: { select: { email: true } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return orders.map((o) => ({
    orderId: o.id,
    reference: o.merchantReference,
    status: o.status,
    environment: o.environment,
    amountLabel: priceLabel(o.amountMinor, o.currency),
    buyerEmail: o.user.email,
    utr: o.payments[0]?.providerPaymentId?.startsWith("upi:") ? o.payments[0].providerPaymentId.slice(4) : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));
}

/** Admin confirms the money arrived (after checking their UPI/bank app). Idempotent. */
export async function confirmUpiPayment(ctx: AppContext, adminId: string, orderId: string) {
  const order = await ctx.db.order.findUnique({ where: { id: orderId } });
  if (!order || order.provider !== UPI_PROVIDER) throw notFound("Order");
  if (order.status === "paid_verified") return grantPaidAccess(ctx, order.id);
  if (!["checkout_ready", "pending_verification"].includes(order.status)) throw conflict("order_closed", "This order was already rejected.");
  await ctx.db.$transaction(async (tx) => {
    const res = await tx.order.updateMany({ where: { id: order.id, status: { in: ["checkout_ready", "pending_verification"] } }, data: { status: "paid_verified" } });
    if (res.count !== 1) throw conflict("state_changed", "This order changed. Refresh and try again.");
    const existing = await tx.payment.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
    if (existing) {
      await tx.payment.update({ where: { id: existing.id }, data: { verified: true, verifiedAt: new Date(), providerStatus: "confirmed_by_admin" } });
    } else {
      await tx.payment.create({
        data: { orderId: order.id, providerPaymentId: `upi-ref:${order.merchantReference}`, providerStatus: "confirmed_by_admin", verified: true, verifiedAt: new Date() },
      });
    }
    await audit(tx, { actorUserId: adminId, actorType: "admin", action: "order.upi_confirmed", resourceType: "order", resourceId: order.id, metadata: { reference: order.merchantReference } });
  });
  return grantPaidAccess(ctx, order.id);
}

export async function rejectUpiPayment(ctx: AppContext, adminId: string, orderId: string) {
  const order = await ctx.db.order.findUnique({ where: { id: orderId } });
  if (!order || order.provider !== UPI_PROVIDER) throw notFound("Order");
  const res = await ctx.db.order.updateMany({ where: { id: order.id, status: { in: ["checkout_ready", "pending_verification"] } }, data: { status: "failed" } });
  if (res.count !== 1) throw conflict("order_closed", "Only unconfirmed payments can be rejected.");
  await ctx.db.payment.updateMany({ where: { orderId: order.id, verified: false }, data: { providerStatus: "rejected_by_admin" } });
  await audit(ctx.db, { actorUserId: adminId, actorType: "admin", action: "order.upi_rejected", resourceType: "order", resourceId: order.id, metadata: { reference: order.merchantReference } });
  await recordConversion(ctx.db, ctx.config, "payment_failed", { userId: order.userId, properties: { environment: "live", method: UPI_PROVIDER, state: "rejected" } });
}
