import { expect, type Page } from "@playwright/test";

export const e2eCode = () => process.env.E2E_CODE!;

/** Signs up through the real form. With `code`, redeems a complimentary code during signup. */
export async function signUp(page: Page, opts: { code?: string | false; next?: string } = {}) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto(opts.next ? `/signup?next=${encodeURIComponent(opts.next)}` : "/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  const code = opts.code === undefined ? e2eCode() : opts.code;
  if (code) {
    await page.getByRole("button", { name: /Have an invitation code/ }).click();
    await page.getByLabel("Invitation code").fill(code);
  }
  await page.getByRole("button", { name: "Create account" }).click();
  if (code) await expect(page).toHaveURL(/\/app\/websites/);
  return email;
}

export async function createWebsite(page: Page, name = "Acme Notes", url = "https://acme-e2e.example.com") {
  await page.getByRole("link", { name: "Connect a website" }).first().click();
  await page.getByLabel("Website name").fill(name);
  await page.getByLabel("Website address").fill(url);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Add First Five to your website" })).toBeVisible();
}
