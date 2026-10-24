import { expect, test } from "@playwright/test";
import { e2eCode, signUp } from "./helpers";

test("landing page: approved structure, honest labels, separate CTAs", async ({ page }) => {
  await page.goto("/?utm_source=e2e");
  await expect(page).toHaveTitle("First Five — Test Your Website With Real Users");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Your app is live\.\s*But can people actually use it\?/);
  await expect(page.getByText("EARLY ACCESS · ONE STUDY FOR ₹99")).toBeVisible();
  await expect(page.getByText("Sample data")).toBeVisible();
  await expect(page.getByText("Illustrative example. All data and quotations are fictional.")).toBeVisible();
  await expect(page.getByText("DESIGN PREVIEW")).toHaveCount(0);
  // Paid and waitlist CTAs lead to different journeys.
  await expect(page.getByRole("link", { name: /Run your first test — ₹99/ }).first()).toHaveAttribute("href", "/access");
  await expect(page.getByRole("link", { name: /Get one study — ₹99/ })).toHaveAttribute("href", "/access");
  await expect(page.getByRole("link", { name: "Join free waitlist" }).first()).toHaveAttribute("href", /^\/waitlist/);
  // In-page navigation
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).click();
  await expect(page.getByRole("heading", { name: "Your first usability study. ₹99." })).toBeInViewport();
  // FAQ accordion works with the keyboard
  const summary = page.getByText("Will you find five testers for me?");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/No\. You invite up to five people/)).toBeVisible();
});

test("waitlist: validates, stores, confirms only after the server does, and grants no access", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Join free waitlist" }).first().click();
  await expect(page.getByRole("heading", { name: "Be first to know." })).toBeVisible();
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await expect(page.getByText("Please enter your name").first()).toBeVisible();
  await page.getByLabel("Your name").fill("E2E Lead");
  await page.getByLabel("Email address").fill(`lead-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await expect(page.getByRole("heading", { name: "You're on the list!" })).toBeVisible();
  // Opening the confirmation URL directly (new tab, no submission) never shows success.
  const fresh = await context.newPage();
  await fresh.goto("/waitlist/success");
  await expect(fresh).toHaveURL(/\/waitlist$/);
  await expect(fresh.getByRole("heading", { name: "Be first to know." })).toBeVisible();
});

test("paid path: offer page is truthful while checkout is not enabled", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Run your first test — ₹99/ }).first().click();
  await expect(page.getByRole("heading", { name: "One complete study. ₹99." })).toBeVisible();
  await expect(page.getByText("Paid access isn't available yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with ₹99 access" })).toBeDisabled();
  // Registered without entitlement → access choices, not the workspace.
  await signUp(page, { code: false, next: "/checkout" });
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByText("No payment can be taken", { exact: false })).toBeVisible();
  await page.goto("/app/websites");
  await expect(page).toHaveURL(/\/access/);
  await page.goto("/payment/status?order=00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("We couldn't find that payment")).toBeVisible();
});

test("judge path: account → invitation code → workspace", async ({ page }) => {
  await page.goto("/access");
  await page.getByRole("link", { name: "Have an invitation code?" }).click();
  await page.getByRole("link", { name: "Create an account" }).click();
  await signUp(page, { code: false, next: "/redeem" });
  await expect(page).toHaveURL(/\/redeem/);
  await page.getByLabel("Invitation code").fill("FF-0000-0000-0000-0000");
  await page.getByRole("button", { name: "Unlock access" }).click();
  await expect(page.getByText("That code isn't valid.")).toBeVisible();
  await page.getByLabel("Invitation code").fill(e2eCode());
  await page.getByRole("button", { name: "Unlock access" }).click();
  await expect(page.getByText("Access unlocked.")).toBeVisible();
  await page.getByRole("button", { name: /Go to your workspace/ }).click();
  await expect(page.getByRole("heading", { name: "Let's start with your website." })).toBeVisible();
  await page.goto("/app/settings");
  await expect(page.getByText("1 unused of 1")).toBeVisible();
});
