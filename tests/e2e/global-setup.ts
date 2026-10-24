/**
 * Starts an embedded PostgreSQL + the built server on :3100 for browser tests.
 * Returns a teardown that stops both.
 */
import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export default async function globalSetup() {
  const dir = resolve(".data/e2e-pg");
  rmSync(dir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "firstfive", password: "firstfive", port: 54331, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("firstfive_e2e");
  const DATABASE_URL = "postgresql://firstfive:firstfive@localhost:54331/firstfive_e2e";
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL }, stdio: "pipe" });
  const server = spawn("node", ["apps/server/dist/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "3100",
      APP_URL: "http://localhost:3100",
      DATABASE_URL,
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-012345",
      LOG_LEVEL: "warn",
      // Pin payment config: Prisma would otherwise load these from a developer's local .env.
      PAYMENTS_ENABLED: "false",
      UPI_PAYEE_VPA: "",
    },
    stdio: "inherit",
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://localhost:3100/readyz");
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.env.E2E_DATABASE_URL = DATABASE_URL;
  // A real complimentary code (multi-use) generated through the admin CLI, for judge/pilot journeys.
  const out = execSync("node apps/server/dist/cli/generate-codes.js --label e2e --audience internal --plan complimentary --count 1 --uses 200 --expires-days 1", {
    env: { ...process.env, DATABASE_URL, SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-012345", NODE_ENV: "test", APP_URL: "http://localhost:3100" },
  }).toString();
  process.env.E2E_CODE = out.match(/FF(-[0-9A-Z]{4}){4}/)![0];
  return async () => {
    server.kill("SIGTERM");
    await pg.stop();
  };
}
