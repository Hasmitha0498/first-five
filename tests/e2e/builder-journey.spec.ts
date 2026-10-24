import { expect, test } from "@playwright/test";
import { createWebsite, signUp } from "./helpers";

test("builder signs up, connects a website, gets a unique snippet, and saves a draft test", async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole("heading", { name: "Let's start with your website." })).toBeVisible();
  await createWebsite(page);

  // Installation snippet: project-specific, honestly labeled as a preview, waiting state.
  const code = page.getByLabel("Installation snippet");
  await expect(code).toContainText('data-firstfive-project="ffp_');
  await expect(page.getByText("Setup preview")).toBeVisible();
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("We haven't received activity from your website yet.").first()).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(0);

  // Journey: no invented pages.
  await page.getByRole("link", { name: "Journey" }).click();
  await expect(page.getByText("We haven't discovered any pages yet.")).toBeVisible();

  // Draft test with unverified manual paths.
  await page.goto("/app/tests/new");
  await page.getByLabel("Give your test a name").fill("Onboarding test");
  await page.getByLabel("What should someone be able to do?").fill("Create an account and reach the dashboard.");
  await page.getByLabel("Where should they begin?").fill("/signup");
  await page.getByLabel("A destination page was reached").check();
  await page.getByLabel("Destination page", { exact: true }).fill("/dashboard");
  await page.getByRole("button", { name: "Save test" }).click();
  await expect(page.getByRole("heading", { name: "Onboarding test" })).toBeVisible();
  await expect(page.getByText("Before you launch")).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch test" })).toBeDisabled();
  await expect(page.getByText("No one has taken this test yet.")).toBeVisible();

  await page.getByRole("link", { name: "Findings", exact: true }).click();
  await expect(page.getByText("AI findings aren't available yet.").first()).toBeVisible();

  // Logout / login
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("settings shows study credits and the invitation code form", async ({ page }) => {
  await signUp(page);
  await page.goto("/app/settings");
  await expect(page.getByText("Complimentary access").first()).toBeVisible();
  await page.getByLabel("Invitation code").fill("FF-0000-0000-0000-0000");
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByText("This invitation code isn't valid.")).toBeVisible();
});

test("unknown participant link shows a friendly message", async ({ page }) => {
  await page.goto("/t/ffs_doesnotexist12345");
  await expect(page.getByText("Test wasn't found.")).toBeVisible();
});
