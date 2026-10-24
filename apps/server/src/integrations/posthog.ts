/**
 * PostHog Cloud adapter.
 *
 * Ingestion uses PostHog's public batch capture endpoint (`POST {host}/batch/`)
 * with the project API key. Reads use the private Query API
 * (`POST {apiHost}/api/projects/{id}/query/` with a HogQL query) and a personal
 * API key. Both keys stay on the server.
 *
 * Status: implemented against PostHog's documented public API but NOT verified
 * against a live PostHog project yet. Status reports "Not configured" until the
 * environment variables are set, and "Verified" only after a test event has been
 * captured and read back (see verifyRoundTrip).
 */
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config";

export interface FirstFiveEventForAnalytics {
  eventId: string;
  eventName: string;
  distinctId: string;
  timestamp: string;
  projectPublicId: string;
  studyPublicId: string | null;
  studyVersion?: number | null;
  sessionPublicId: string | null;
  mode: "setup" | "live";
  clientSequence: number | null;
  pagePath: string | null;
  elementKey: string | null;
  elementType: string | null;
  elementLabel: string | null;
  customEventName: string | null;
}

export interface PostHogCaptureEvent {
  event: string;
  distinct_id: string;
  uuid: string;
  timestamp: string;
  properties: Record<string, string | number | boolean | null>;
}

/**
 * Map a First Five canonical event to PostHog's capture format.
 * First Five's task-session ID goes into `ff_session_id`; PostHog's own
 * `$session_id` is never overwritten.
 */
export function mapToPostHogEvent(e: FirstFiveEventForAnalytics): PostHogCaptureEvent {
  return {
    event: e.eventName,
    distinct_id: e.distinctId,
    uuid: e.eventId,
    timestamp: e.timestamp,
    properties: {
      distinct_id: e.distinctId,
      $process_person_profile: false,
      ff_event_id: e.eventId,
      ff_project_id: e.projectPublicId,
      ff_study_id: e.studyPublicId,
      ff_study_version: e.studyVersion ?? null,
      ff_session_id: e.sessionPublicId,
      ff_mode: e.mode,
      ff_client_sequence: e.clientSequence,
      ff_page_path: e.pagePath,
      ff_element_key: e.elementKey,
      ff_element_type: e.elementType,
      ff_element_label: e.elementLabel,
      ff_custom_event_name: e.customEventName,
    },
  };
}

export interface HealthResult {
  ok: boolean;
  status: "verified" | "verification_pending" | "error" | "not_configured";
  message: string;
  details?: Record<string, unknown>;
}

export interface AnalyticsProvider {
  readonly name: "posthog";
  readonly configured: boolean;
  readonly canQuery: boolean;
  missingKeys(): string[];
  captureBatch(events: PostHogCaptureEvent[]): Promise<void>;
  /** `values` fill `{name}` placeholders server-side; never interpolate untrusted input into `hogql`. */
  query<T = unknown[]>(hogql: string, values?: Record<string, unknown>): Promise<T[]>;
  verifyRoundTrip(): Promise<HealthResult>;
}

export class PostHogAdapter implements AnalyticsProvider {
  readonly name = "posthog" as const;
  private readonly host?: string;
  private readonly apiHost?: string;

  constructor(
    private readonly config: Pick<
      AppConfig,
      "POSTHOG_HOST" | "POSTHOG_API_HOST" | "POSTHOG_PROJECT_API_KEY" | "POSTHOG_PERSONAL_API_KEY" | "POSTHOG_PROJECT_ID"
    >,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.host = config.POSTHOG_HOST?.replace(/\/+$/, "");
    this.apiHost = (config.POSTHOG_API_HOST ?? this.host?.replace(".i.posthog.com", ".posthog.com"))?.replace(/\/+$/, "");
  }

  get configured(): boolean {
    return Boolean(this.host && this.config.POSTHOG_PROJECT_API_KEY);
  }

  get canQuery(): boolean {
    return Boolean(this.apiHost && this.config.POSTHOG_PERSONAL_API_KEY && this.config.POSTHOG_PROJECT_ID);
  }

  missingKeys(): string[] {
    const keys: [string, unknown][] = [
      ["POSTHOG_HOST", this.config.POSTHOG_HOST],
      ["POSTHOG_PROJECT_API_KEY", this.config.POSTHOG_PROJECT_API_KEY],
      ["POSTHOG_PERSONAL_API_KEY", this.config.POSTHOG_PERSONAL_API_KEY],
      ["POSTHOG_PROJECT_ID", this.config.POSTHOG_PROJECT_ID],
    ];
    return keys.filter(([, v]) => !v).map(([k]) => k);
  }

  async captureBatch(events: PostHogCaptureEvent[]): Promise<void> {
    if (!this.configured) throw new Error("PostHog is not configured");
    if (events.length === 0) return;
    const res = await this.fetchImpl(`${this.host}/batch/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: this.config.POSTHOG_PROJECT_API_KEY, historical_migration: false, batch: events }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`PostHog capture failed with HTTP ${res.status}`);
  }

  async query<T = unknown[]>(hogql: string, values?: Record<string, unknown>): Promise<T[]> {
    if (!this.canQuery) throw new Error("PostHog query access is not configured");
    const res = await this.fetchImpl(`${this.apiHost}/api/projects/${encodeURIComponent(this.config.POSTHOG_PROJECT_ID!)}/query/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.POSTHOG_PERSONAL_API_KEY}`,
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql, ...(values ? { values } : {}) } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`PostHog query failed with HTTP ${res.status}`);
    const body = (await res.json()) as { results?: T[] };
    return body.results ?? [];
  }

  /** Capture a uniquely identified check event, then try to read it back. */
  async verifyRoundTrip(): Promise<HealthResult> {
    if (!this.configured) {
      return { ok: false, status: "not_configured", message: `Missing: ${this.missingKeys().join(", ")}` };
    }
    const id = randomUUID();
    try {
      await this.captureBatch([
        {
          event: "ff_integration_check",
          distinct_id: "first_five_integration_check",
          uuid: id,
          timestamp: new Date().toISOString(),
          properties: { distinct_id: "first_five_integration_check", $process_person_profile: false, ff_check_id: id },
        },
      ]);
    } catch (err) {
      return { ok: false, status: "error", message: `Capture failed: ${(err as Error).message}` };
    }
    if (!this.canQuery) {
      return {
        ok: false,
        status: "verification_pending",
        message: "A test event was sent, but query access isn't configured so it can't be read back yet.",
        details: { checkId: id },
      };
    }
    try {
      const rows = await this.query(
        "SELECT count() FROM events WHERE event = 'ff_integration_check' AND properties.ff_check_id = {check_id} AND timestamp > now() - INTERVAL 1 HOUR",
        { check_id: id },
      );
      const count = Number((rows[0] as unknown[] | undefined)?.[0] ?? 0);
      if (count > 0) return { ok: true, status: "verified", message: "Test event captured and read back.", details: { checkId: id } };
      return {
        ok: false,
        status: "verification_pending",
        message: "Test event sent; PostHog hasn't made it queryable yet. Run verification again in a minute.",
        details: { checkId: id },
      };
    } catch (err) {
      return { ok: false, status: "error", message: `Query failed: ${(err as Error).message}` };
    }
  }
}
