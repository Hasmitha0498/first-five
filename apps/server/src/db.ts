import { PrismaClient } from "@prisma/client";

export type Db = PrismaClient;

export function createDb(databaseUrl?: string): PrismaClient {
  return new PrismaClient({
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
    log: ["warn", "error"],
  });
}
