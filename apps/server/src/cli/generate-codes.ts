/**
 * Generate invitation codes (admin CLI). Codes are printed once and only their
 * HMAC verifiers are stored.
 *
 *   npm run admin:codes -- --label "Judges Oct 2026" --audience judge --plan complimentary \
 *     --count 10 --uses 1 --expires-days 30 [--grant-days 60]
 */
import { GenerateCodesSchema } from "@firstfive/shared";
import { generateCodes } from "../services/access-codes";
import { arg, cliContext } from "./_ctx";

const ctx = cliContext();
const num = (v: string | undefined) => (v ? Number(v) : undefined);
const input = GenerateCodesSchema.parse({
  label: arg("label") ?? "Invitation codes",
  audience: arg("audience") ?? "judge",
  planKey: arg("plan") ?? "complimentary",
  count: num(arg("count")) ?? 1,
  maxRedemptions: num(arg("uses")) ?? 1,
  expiresInDays: num(arg("expires-days")),
  grantDays: num(arg("grant-days")),
});
const { codes, records } = await generateCodes(ctx, input);
console.log(`Generated ${codes.length} code(s) — label "${input.label}", plan ${input.planKey}, ${input.maxRedemptions} use(s) each.`);
console.log("Store these securely; they cannot be shown again:\n");
codes.forEach((c, i) => console.log(`  ${c}   (id ${records[i]!.id})`));
await ctx.db.$disconnect();
