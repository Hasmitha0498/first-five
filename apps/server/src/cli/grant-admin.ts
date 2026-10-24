/** Grant the admin role to an existing account:  npm run admin:grant-admin -- --email you@example.com */
import { audit } from "../lib/audit";
import { arg, cliContext } from "./_ctx";

const ctx = cliContext();
const email = arg("email")?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run admin:grant-admin -- --email you@example.com");
  process.exit(1);
}
const user = await ctx.db.user.findUnique({ where: { email } });
if (!user) {
  console.error(`No account found for ${email}. Sign up first.`);
  process.exit(1);
}
await ctx.db.user.update({ where: { id: user.id }, data: { role: "admin" } });
await audit(ctx.db, { actorType: "system", action: "user.admin_granted", resourceType: "user", resourceId: user.id });
console.log(`${email} is now an admin.`);
await ctx.db.$disconnect();
