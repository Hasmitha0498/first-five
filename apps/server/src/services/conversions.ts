/**
 * Privacy-conscious funnel events. Only completed actions are recorded; payment
 * and access events are emitted by the server after verification, never by the browser.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config";

type Tx = PrismaClient | Prisma.TransactionClient;

export type ConversionName =
  | "landing_page_viewed"
  | "paid_cta_clicked"
  | "waitlist_cta_clicked"
  | "waitlist_submitted"
  | "access_page_viewed"
  | "signup_completed"
  | "checkout_started"
  | "payment_verified"
  | "payment_failed"
  | "invitation_code_redeemed"
  | "workspace_activated"
  | "project_created"
  | "study_launched";

export async function recordConversion(
  db: Tx,
  config: Pick<AppConfig, "NODE_ENV">,
  name: ConversionName,
  opts: { visitorId?: string | null; userId?: string | null; properties?: Record<string, string | number | boolean | null | undefined> } = {},
) {
  const properties = opts.properties ? Object.fromEntries(Object.entries(opts.properties).filter(([, v]) => v !== undefined && v !== null && v !== "")) : undefined;
  await db.conversionEvent.create({
    data: {
      name,
      visitorId: opts.visitorId ?? null,
      userId: opts.userId ?? null,
      environment: config.NODE_ENV,
      properties: properties && Object.keys(properties).length ? (properties as Prisma.InputJsonValue) : undefined,
    },
  });
}

/** Records workspace_activated the first time an account receives any access grant. */
export async function recordActivationIfFirst(db: Tx, config: Pick<AppConfig, "NODE_ENV">, userId: string, source: string) {
  const grants = await db.accessGrant.count({ where: { userId } });
  if (grants === 1) await recordConversion(db, config, "workspace_activated", { userId, properties: { source } });
}
