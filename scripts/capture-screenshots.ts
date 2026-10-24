/**
 * Captures visual QA screenshots of the public journeys from a running server.
 *   BASE_URL=http://localhost:3001 PW_CHANNEL=chrome npx tsx scripts/capture-screenshots.ts
 * Creates one throwaway local account (to show signed-in screens). Never point this at production.
 */
import { chromium, devices } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3001";
if (!/localhost|127\.0\.0\.1/.test(base)) throw new Error("Refusing to run against a non-local URL");
const out = "qa/screenshots";

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await desk.newPage();

await p.goto(base + "/");
await p.waitForLoadState("networkidle");
await p.screenshot({ path: `${out}/01-landing-desktop-above-fold.png` });
await p.screenshot({ path: `${out}/02-landing-desktop-full.png`, fullPage: true });

await p.goto(base + "/waitlist?from=hero");
await p.screenshot({ path: `${out}/04-waitlist-form.png`, fullPage: true });
await p.getByLabel("Your name").fill("Screenshot Lead");
await p.getByLabel("Email address").fill(`screenshot-${Date.now()}@example.com`);
await p.getByRole("button", { name: "Join waitlist" }).click();
await p.getByRole("heading", { name: "You're on the list!" }).waitFor();
await p.screenshot({ path: `${out}/05-waitlist-confirmation.png`, fullPage: true });

await p.goto(base + "/access");
await p.getByText("Paid access isn't available yet.").waitFor();
await p.screenshot({ path: `${out}/06-access-offer.png`, fullPage: true });

await p.goto(base + "/redeem");
await p.screenshot({ path: `${out}/07-redeem-signed-out.png`, fullPage: true });

// Signed-in screens with a throwaway local account.
await p.goto(base + "/signup?next=/redeem");
await p.getByLabel("Email").fill(`screenshot-${Date.now()}@example.com`);
await p.getByLabel("Password").fill("screenshot-local-pass-1");
await p.getByRole("button", { name: "Create account" }).click();
await p.getByRole("button", { name: "Unlock access" }).waitFor();
await p.getByLabel("Invitation code").fill("FF-0000-0000-0000-0000");
await p.getByRole("button", { name: "Unlock access" }).click();
await p.getByText("That code isn't valid.").waitFor();
await p.screenshot({ path: `${out}/08-redeem-invalid-code.png`, fullPage: true });

await p.goto(base + "/checkout");
await p.getByText("Paid access isn't available yet.").waitFor();
await p.screenshot({ path: `${out}/09-checkout-unavailable.png`, fullPage: true });

await p.goto(base + "/payment/status?order=00000000-0000-4000-8000-000000000000");
await p.getByText("We couldn't find that payment").waitFor();
await p.screenshot({ path: `${out}/10-payment-status-not-found.png`, fullPage: true });

const mob = await browser.newContext({ ...devices["iPhone 13"] });
const m = await mob.newPage();
await m.goto(base + "/");
await m.waitForLoadState("networkidle");
await m.screenshot({ path: `${out}/03-landing-mobile-above-fold.png` });
await m.screenshot({ path: `${out}/03b-landing-mobile-full.png`, fullPage: true });

await browser.close();
console.log("Saved screenshots to", out);
