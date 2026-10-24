import type { ProviderStatusDto } from "@firstfive/shared";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { AgenticOrgAdapter, type UxDirectorProvider } from "./agenticorg";
import { PineLabsAdapter, type PaymentProvider } from "./pinelabs";
import { PostHogAdapter, type AnalyticsProvider, type HealthResult } from "./posthog";

export interface Providers {
  analytics: AnalyticsProvider;
  uxDirector: UxDirectorProvider;
  payments: PaymentProvider;
}

export function createProviders(config: AppConfig): Providers {
  return {
    analytics: new PostHogAdapter(config),
    uxDirector: new AgenticOrgAdapter(config),
    payments: new PineLabsAdapter(config),
  };
}

export type ProviderKey = ProviderStatusDto["provider"];
export const PROVIDER_KEYS: ProviderKey[] = ["postgres", "sdk", "posthog", "agenticorg", "pinelabs"];

const META: Record<ProviderKey, { name: string; description: string; keys: (keyof AppConfig)[] }> = {
  postgres: {
    name: "Render PostgreSQL",
    description: "Authoritative store for accounts, studies, task outcomes, feedback and reports.",
    keys: ["DATABASE_URL"],
  },
  sdk: {
    name: "First Five SDK (separate project)",
    description: "Externally hosted browser script. This app only generates snippets and exposes the SDK API contract.",
    keys: ["SDK_SCRIPT_URL"],
  },
  posthog: {
    name: "PostHog Cloud",
    description: "Detailed behavioral analytics: paths, funnels and event timelines.",
    keys: ["POSTHOG_HOST", "POSTHOG_PROJECT_API_KEY", "POSTHOG_PERSONAL_API_KEY", "POSTHOG_PROJECT_ID"],
  },
  agenticorg: {
    name: "AgenticOrg — UX Director",
    description: "Contextual interview questions, research findings and human-approved publishing.",
    keys: ["AGENTICORG_BASE_URL", "AGENTICORG_API_KEY", "AGENTICORG_Q2_AGENT_ID", "AGENTICORG_REPORT_AGENT_ID"],
  },
  pinelabs: {
    name: "Pine Labs",
    description: "Hosted checkout for paid access.",
    keys: ["PINELABS_BASE_URL", "PINELABS_CLIENT_ID", "PINELABS_CLIENT_SECRET", "PINELABS_MERCHANT_ID", "PINELABS_WEBHOOK_SECRET"],
  },
};

function envConfigured(config: AppConfig, key: ProviderKey): boolean {
  return META[key].keys.every((k) => Boolean(config[k]));
}

/**
 * Status = configuration presence + the result of the last *real* verification.
 * Entering settings alone never yields "verified".
 */
export async function listProviderStatuses(config: AppConfig, db: Db): Promise<ProviderStatusDto[]> {
  const rows = await db.providerConnection.findMany();
  const byKey = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDER_KEYS.map((key) => {
    const row = byKey.get(key);
    const configured = envConfigured(config, key);
    let status: ProviderStatusDto["status"] = configured ? "configured" : "not_configured";
    if (configured && row && row.status !== "not_configured") status = row.status;
    return {
      provider: key,
      name: META[key].name,
      description: META[key].description,
      status,
      configuredKeys: META[key].keys.map((k) => ({ key: String(k), present: Boolean(config[k]) })),
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastError: configured ? (row?.lastError ?? null) : null,
      details: (row?.details as Record<string, unknown> | null) ?? null,
    };
  });
}

export async function providerStatus(config: AppConfig, db: Db, key: ProviderKey): Promise<ProviderStatusDto["status"]> {
  const all = await listProviderStatuses(config, db);
  return all.find((p) => p.provider === key)!.status;
}

/** Runs an actual provider test and records the outcome. */
export async function verifyProvider(
  config: AppConfig,
  db: Db,
  providers: Providers,
  key: ProviderKey,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResult> {
  let result: HealthResult;
  switch (key) {
    case "postgres":
      try {
        await db.$queryRaw`SELECT 1`;
        result = { ok: true, status: "verified", message: "Database query succeeded." };
      } catch (err) {
        result = { ok: false, status: "error", message: `Database query failed: ${(err as Error).message}` };
      }
      break;
    case "sdk":
      result = await verifySdkScript(config, db, fetchImpl);
      break;
    case "posthog":
      result = await providers.analytics.verifyRoundTrip();
      break;
    case "agenticorg":
      result = await providers.uxDirector.healthCheck();
      break;
    case "pinelabs":
      result = await providers.payments.healthCheck();
      break;
  }
  const now = new Date();
  await db.providerConnection.upsert({
    where: { provider: key },
    create: {
      provider: key,
      status: result.status,
      lastCheckedAt: now,
      lastSuccessAt: result.ok ? now : null,
      lastError: result.ok ? null : result.message,
      details: (result.details ?? { message: result.message }) as object,
    },
    update: {
      status: result.status,
      lastCheckedAt: now,
      ...(result.ok ? { lastSuccessAt: now, lastError: null } : { lastError: result.message }),
      details: (result.details ?? { message: result.message }) as object,
    },
  });
  return result;
}

async function verifySdkScript(config: AppConfig, db: Db, fetchImpl: typeof fetch): Promise<HealthResult> {
  if (!config.SDK_SCRIPT_URL) {
    return { ok: false, status: "not_configured", message: "SDK_SCRIPT_URL isn't set; snippets are shown as a setup preview." };
  }
  let scriptOk = false;
  let detail = "";
  try {
    const res = await fetchImpl(config.SDK_SCRIPT_URL, { method: "GET", signal: AbortSignal.timeout(8000), redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    scriptOk = res.ok && /javascript|ecmascript/.test(type);
    detail = `HTTP ${res.status}, content-type ${type || "unknown"}`;
  } catch (err) {
    detail = (err as Error).message;
  }
  if (!scriptOk) return { ok: false, status: "error", message: `SDK script not reachable as JavaScript (${detail}).` };
  const connected = await db.project.count({ where: { integrationStatus: "connected" } });
  if (connected === 0) {
    return {
      ok: false,
      status: "verification_pending",
      message: "SDK script is reachable. No website has completed a verified setup walk yet.",
      details: { script: detail },
    };
  }
  return { ok: true, status: "verified", message: `SDK script reachable; ${connected} website(s) verified.`, details: { script: detail } };
}
