import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("mobile navigation and layouts have no horizontal overflow", async ({ page }) => {
  for (const path of ["/", "/sample-report", "/signup", "/access", "/waitlist", "/redeem", "/privacy"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  await signUp(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "App" }).getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/app\/settings/);
});
