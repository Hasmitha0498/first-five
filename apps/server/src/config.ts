import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");
const int = (def: number) => z.coerce.number().int().positive().default(def);
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Public base URL of this app. Falls back to Render's RENDER_EXTERNAL_URL. */
  APP_URL: optionalString,
  RENDER_EXTERNAL_URL: optionalString,
  /** Extra origins allowed to call the cookie-authenticated API (e.g. Vite dev server). */
  DEV_WEB_ORIGIN: optionalString,
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  LOG_LEVEL: z.string().default("info"),
  /**
   * One-time admin bootstrap for hosts without shell access (e.g. Render free plan).
   * Works only while NO admin exists; remove it after use.
   */
  ADMIN_BOOTSTRAP_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined))
    .refine((v) => v === undefined || v.length >= 24, "ADMIN_BOOTSTRAP_TOKEN must be at least 24 characters"),

  // Externally hosted SDK (built in a separate project). Unset ⇒ snippet is a setup preview.
  SDK_SCRIPT_URL: optionalString,

  // Access & pricing (configurable). One paid purchase or code = study credits.
  PAID_STUDY_PRICE_MINOR: z.coerce.number().int().nonnegative().default(9900),
  PAID_STUDY_CURRENCY: z.string().default("INR"),
  PAID_STUDY_CREDITS: int(1),
  PAID_PARTICIPANT_CAP: int(5),
  /** Live/sandbox checkout opens ONLY when this is true AND Pine Labs is implemented + configured. */
  PAYMENTS_ENABLED: bool,
  DEFAULT_CODE_STUDY_CREDITS: int(1),
  DEFAULT_CODE_PARTICIPANT_CAP: int(5),
  /** Unlaunched draft studies an entitled account may hold at once. */
  MAX_DRAFT_STUDIES: int(10),

  // Retention and scheduling.
  EVENT_RETENTION_DAYS: int(30),
  OUTBOX_RETENTION_DAYS: int(14),
  SWEEP_INTERVAL_SECONDS: int(60),
  /** How long a cached PostHog dashboard snapshot is served before a background refresh. */
  ANALYTICS_SNAPSHOT_TTL_SECONDS: int(300),
  DISABLE_SCHEDULER: bool,

  // PostHog Cloud.
  /** Ingestion host, e.g. https://us.i.posthog.com or https://eu.i.posthog.com */
  POSTHOG_HOST: optionalString,
  /** Private API host for queries, e.g. https://us.posthog.com. Derived from POSTHOG_HOST when unset. */
  POSTHOG_API_HOST: optionalString,
  POSTHOG_PROJECT_API_KEY: optionalString,
  POSTHOG_PERSONAL_API_KEY: optionalString,
  POSTHOG_PROJECT_ID: optionalString,

  // AgenticOrg UX Director. Agents are run by stored agent ID (execution-scoped key).
  AGENTICORG_BASE_URL: optionalString,
  AGENTICORG_API_KEY: optionalString,
  /** Stored agent that writes the contextual interview question (Q2). */
  AGENTICORG_Q2_AGENT_ID: optionalString,
  /** Stored agent that drafts the research report; every run queues an AgenticOrg HITL approval. */
  AGENTICORG_REPORT_AGENT_ID: optionalString,
  /** Key allowed to read approvals (approvals:read). Without it, decisions can't be confirmed and publishing stays blocked. */
  AGENTICORG_APPROVALS_API_KEY: optionalString,
  AGENTICORG_Q2_TIMEOUT_MS: int(8000),
  AGENTICORG_REPORT_TIMEOUT_MS: int(150_000),
  AGENTICORG_WORKFLOW_ID: optionalString,
  AGENTICORG_WEBHOOK_SECRET: optionalString,

  // Pine Labs (future integration).
  PINELABS_ENV: z.enum(["uat", "live"]).default("uat"),
  PINELABS_BASE_URL: optionalString,
  PINELABS_CLIENT_ID: optionalString,
  PINELABS_CLIENT_SECRET: optionalString,
  PINELABS_MERCHANT_ID: optionalString,
  PINELABS_WEBHOOK_SECRET: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig extends Env {
  appUrl: string;
  appOrigin: string;
  isProduction: boolean;
  secureCookies: boolean;
  /** Origins permitted to make cookie-authenticated, state-changing requests. */
  trustedWebOrigins: string[];
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  // the Render env group names the PostHog project token POSTHOG_PROJECT_TOKEN
  if (!env.POSTHOG_PROJECT_API_KEY && source.POSTHOG_PROJECT_TOKEN) env.POSTHOG_PROJECT_API_KEY = source.POSTHOG_PROJECT_TOKEN;
  const appUrl = (env.APP_URL ?? env.RENDER_EXTERNAL_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, "");
  const appOrigin = new URL(appUrl).origin;
  const isProduction = env.NODE_ENV === "production";
  if (isProduction && !appUrl.startsWith("https://")) {
    throw new Error("APP_URL (or RENDER_EXTERNAL_URL) must use https in production");
  }
  const trustedWebOrigins = [appOrigin];
  if (env.DEV_WEB_ORIGIN && !isProduction) trustedWebOrigins.push(new URL(env.DEV_WEB_ORIGIN).origin);
  return {
    ...env,
    appUrl,
    appOrigin,
    isProduction,
    secureCookies: appUrl.startsWith("https://"),
    trustedWebOrigins,
  };
}
