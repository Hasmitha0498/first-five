/**
 * Local development PostgreSQL (no Docker/Homebrew needed): starts a persistent
 * embedded PostgreSQL on port 54320 with data in .data/dev-pg.
 *   npm run dev:db      → then in another terminal: npx prisma migrate deploy
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const dir = resolve(".data/dev-pg");
const fresh = !existsSync(dir);
mkdirSync(resolve(".data"), { recursive: true });
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "firstfive", password: "firstfive", port: 54320, persistent: true });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("firstfive");
console.log("PostgreSQL ready: postgresql://firstfive:firstfive@localhost:54320/firstfive  (Ctrl+C to stop)");
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
