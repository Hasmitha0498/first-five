import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, json, resetDb, signup, signupWithAccess, type Harness } from "../setup/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await resetDb(h.db);
});
afterAll(async () => h.close());

describe("projects", () => {
  it("creates a project with a unique public ID and a labeled preview snippet (A01)", async () => {
    const a = await signupWithAccess(h);
    const b = await signupWithAccess(h);
    const pa = json(await a.client.post("/api/projects", { name: "A", websiteUrl: "https://a.example.com/app" }));
    const pb = json(await b.client.post("/api/projects", { name: "B", websiteUrl: "b.example.com" }));
    expect(pa.publicId).toMatch(/^ffp_/);
    expect(pa.publicId).not.toBe(pb.publicId);
    expect(pa.canonicalOrigin).toBe("https://a.example.com");
    expect(pb.websiteUrl).toBe("https://b.example.com/");
    expect(pa.integrationStatus).toBe("setup_not_started");
    expect(pa.snippet.isPreview).toBe(true);
    expect(pa.snippet.html).toContain(`data-firstfive-project="${pa.publicId}"`);
    expect(pa.snippet.html).toContain("YOUR-SDK-HOST");
    // Owner isolation (A17)
    expect((await b.client.get(`/api/projects/${pa.id}`)).statusCode).toBe(404);
    expect((await b.client.get(`/api/projects/${pa.id}/discovery`)).statusCode).toBe(404);
    expect((await b.client.post(`/api/projects/${pa.id}/setup-sessions`)).statusCode).toBe(404);
  });

  it("enforces the free pilot website limit", async () => {
    const { client } = await signupWithAccess(h);
    expect((await client.post("/api/projects", { name: "One", websiteUrl: "https://one.example.com" })).statusCode).toBe(201);
    const second = await client.post("/api/projects", { name: "Two", websiteUrl: "https://two.example.com" });
    expect(second.statusCode).toBe(403);
    expect(json(second).error.code).toBe("entitlement_limit");
  });

  it("validates website addresses", async () => {
    const { client } = await signupWithAccess(h);
    const res = await client.post("/api/projects", { name: "Bad", websiteUrl: "https://user:pass@x.example.com" });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.fields.websiteUrl).toBeTruthy();
  });

  it("only reports Waiting for connection until real SDK evidence arrives", async () => {
    const { client } = await signupWithAccess(h);
    const p = json(await client.post("/api/projects", { name: "W", websiteUrl: "https://w.example.com" }));
    await client.post(`/api/projects/${p.id}/snippet-copied`);
    const check = json(await client.post(`/api/projects/${p.id}/check-connection`));
    expect(check.integrationStatus).toBe("awaiting_connection");
    expect(check.message).toMatch(/haven't received activity/);
    const disc = json(await client.get(`/api/projects/${p.id}/discovery`));
    expect(disc.pages).toEqual([]);
    expect(disc.elements).toEqual([]);
  });

  it("generates the snippet from SDK_SCRIPT_URL when configured", async () => {
    const h2 = await createHarness({ SDK_SCRIPT_URL: "https://cdn.firstfive.example/v1/firstfive.js" });
    try {
      const { client } = await signupWithAccess(h2);
      const p = json(await client.post("/api/projects", { name: "S", websiteUrl: "https://s.example.com" }));
      expect(p.snippet.isPreview).toBe(false);
      expect(p.snippet.html).toContain('src="https://cdn.firstfive.example/v1/firstfive.js"');
      expect(p.snippet.assistantPrompt).toContain("Do not collect sensitive input values");
    } finally {
      await h2.close();
    }
  });
});
