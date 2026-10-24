/**
 * Full Render-side journey in a real browser.
 *
 * The customer website and the SDK are SIMULATED here: the website is a stub
 * page served by Playwright routing, and SDK calls are made with hand-built
 * contract fixtures (docs/integrations/SDK_INTEGRATION.md). This proves the
 * First Five UI + API flow, NOT that the separately developed SDK works.
 */
import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import { createWebsite, signUp } from "./helpers";

const SITE = "https://acme-e2e.example.com";

function ev(base: Record<string, unknown>, seq: number, fields: Record<string, unknown>) {
  return { schema_version: 1, event_id: randomUUID(), client_sequence: seq, timestamp: new Date().toISOString(), ...base, ...fields };
}

test("connect (fixture) → launch → participant consents → finishes → feedback → dashboard", async ({ page, browser, baseURL }) => {
  const sdk = await request.newContext({ baseURL, extraHTTPHeaders: { origin: SITE } });

  await signUp(page);
  await createWebsite(page, "Acme Notes", SITE);
  const projectId = page.url().split("/app/websites/")[1]!.split("/")[0]!;
  const project = await (await page.request.get(`/api/projects/${projectId}`)).json();

  // Builder opens the setup walkthrough; the SDK fixture exchanges the ticket and reports the journey.
  const setup = await (await page.request.post(`/api/projects/${projectId}/setup-sessions`, { headers: { origin: baseURL! } })).json();
  const setupTicket = new URL(setup.launchUrl).hash.replace("#ff_setup=", "");
  const ex = await (await sdk.post("/api/sdk/exchange", { data: { project_id: project.publicId, ticket: setupTicket } })).json();
  const sbase = { project_id: project.publicId, mode: "setup" };
  const setupRes = await sdk.post("/api/sdk/events", {
    headers: { authorization: `Bearer ${ex.credential}` },
    data: {
      schema_version: 1,
      events: [
        ev(sbase, 0, { event_name: "ff_page_viewed", page_path: "/signup" }),
        ev(sbase, 1, { event_name: "ff_element_discovered", page_path: "/signup", element_id: "create-account", element_type: "button", element_label: "Create account" }),
        ev(sbase, 2, { event_name: "ff_page_viewed", page_path: "/dashboard" }),
      ],
    },
  });
  expect(setupRes.status()).toBe(200);

  await page.getByRole("link", { name: "Journey" }).click();
  await expect(page.getByText("Connected").first()).toBeVisible();
  await expect(page.getByText("/dashboard").first()).toBeVisible();

  // Configure from discovered pages and launch.
  await page.goto(`/app/tests/new?website=${projectId}`);
  await page.getByLabel("Give your test a name").fill("Onboarding test");
  await page.getByLabel("What should someone be able to do?").fill("Create an account and reach the dashboard.");
  await page.getByLabel("Where should they begin?").selectOption("/signup");
  await page.getByLabel("A destination page was reached").check();
  await page.getByLabel("Destination page", { exact: true }).selectOption("/dashboard");
  await page.getByRole("button", { name: "Save test" }).click();
  await expect(page.getByText("Ready to launch")).toBeVisible();
  await page.getByRole("button", { name: "Launch test" }).click();
  await expect(page.getByRole("heading", { name: "Your test is ready." })).toBeVisible();
  const shareUrl = (await page.locator("div.font-mono").first().textContent())!.trim();

  // Participant in a separate browser context.
  const pctx = await browser.newContext();
  await pctx.route(`${SITE}/**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Acme</title><h1>Acme (stub)</h1>" }));
  const participant = await pctx.newPage();
  await participant.goto(shareUrl);
  await expect(participant.getByText("Your task")).toBeVisible();
  await expect(participant.getByText("Create an account and reach the dashboard.")).toBeVisible();
  await expect(participant.getByRole("button", { name: "Start test" })).toBeDisabled();
  await participant.getByLabel(/I agree to have my activity recorded/).check();
  const [site] = await Promise.all([pctx.waitForEvent("page"), participant.getByRole("button", { name: "Start test" }).click()]);
  await site.waitForURL(/ff_launch=/);
  const launchTicket = new URL(site.url()).hash.replace("#ff_launch=", "");
  await expect(participant.getByText("Your test is in progress")).toBeVisible();

  // SDK fixture: exchange, reach the goal.
  const live = await (await sdk.post("/api/sdk/exchange", { data: { project_id: project.publicId, ticket: launchTicket } })).json();
  const lbase = { project_id: project.publicId, mode: "live", study_id: live.study.study_id, session_id: live.study.session_id };
  const goal = await (
    await sdk.post("/api/sdk/events", {
      headers: { authorization: `Bearer ${live.credential}` },
      data: { schema_version: 1, events: [ev(lbase, 0, { event_name: "ff_page_viewed", page_path: "/signup" }), ev(lbase, 1, { event_name: "ff_page_viewed", page_path: "/dashboard" })] },
    })
  ).json();
  expect(goal.goal.verified).toBe(true);

  // Participant returns and finishes → interview.
  await participant.bringToFront();
  await participant.getByRole("button", { name: "I've finished" }).click();
  await expect(participant.getByRole("heading", { name: "Thanks for testing. Three quick questions." })).toBeVisible();
  expect(participant.url()).not.toContain("#h=");
  await participant.getByLabel("Easy", { exact: true }).check();
  await participant.getByLabel(/What would have made this task easier/).fill("A shorter signup form.");
  await participant.getByRole("button", { name: "Submit feedback" }).click();
  await expect(participant.getByText("Thank you — you're all done.")).toBeVisible();

  // Builder sees real, reconciled numbers.
  await page.getByRole("link", { name: "Go to test overview" }).click();
  await page.reload();
  await expect(page.getByText("Completed").first()).toBeVisible();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /^Participants/ }).click();
  await page.getByRole("link", { name: "Participant 1" }).click();
  await expect(page.getByText("Goal verified")).toBeVisible();
  await expect(page.getByText("“A shorter signup form.”")).toBeVisible();

  await pctx.close();
  await sdk.dispose();
});
