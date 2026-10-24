import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests run against a locally started production build:
 *   npm run build && npm run test:e2e
 * E2E_BASE_URL can point at a deployed instance instead.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // PW_CHANNEL=chrome uses an installed Google Chrome instead of the downloaded Chromium build.
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", channel: process.env.PW_CHANNEL || undefined },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /responsive\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  globalSetup: process.env.E2E_BASE_URL ? undefined : "./tests/e2e/global-setup.ts",
});
