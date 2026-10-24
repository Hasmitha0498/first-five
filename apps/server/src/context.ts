import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import type { Providers } from "./integrations/registry";

/** Dependencies shared by services and routes. */
export interface AppContext {
  config: AppConfig;
  db: Db;
  providers: Providers;
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error" | "debug">;
}
