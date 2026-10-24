import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { runMaintenance } from "./services/maintenance";

async function main() {
  const config = loadConfig();
  const db = createDb();
  const { app, ctx } = await buildApp({ config, db });

  // Best-effort background maintenance. Correctness never depends on it:
  // deadlines are also reconciled on demand before every relevant read/write.
  let timer: NodeJS.Timeout | undefined;
  if (!config.DISABLE_SCHEDULER) {
    let running = false;
    timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await runMaintenance(ctx);
      } catch (err) {
        app.log.error({ err }, "maintenance run failed");
      } finally {
        running = false;
      }
    }, config.SWEEP_INTERVAL_SECONDS * 1000);
    timer.unref();
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    if (timer) clearInterval(timer);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      await db.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ appUrl: config.appUrl, sdkScriptConfigured: Boolean(config.SDK_SCRIPT_URL) }, "First Five is running");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
