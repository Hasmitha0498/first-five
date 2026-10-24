import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  actorUserId?: string | null;
  actorType: "user" | "admin" | "participant" | "sdk" | "system" | "provider";
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Audit metadata must never contain secrets, tokens or raw participant answers. */
export async function audit(db: Tx, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorType,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata,
    },
  });
}
