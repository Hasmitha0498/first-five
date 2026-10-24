/** Run deadline reconciliation, analytics delivery and retention purge once (suitable for a Render cron job). */
import { runMaintenance } from "../services/maintenance";
import { cliContext } from "./_ctx";

const ctx = cliContext();
console.log(JSON.stringify(await runMaintenance(ctx), null, 2));
await ctx.db.$disconnect();
