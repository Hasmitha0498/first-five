/**
 * AgenticOrg "UX Director" integration interface.
 *
 * The live connector is intentionally NOT implemented: AgenticOrg's actual
 * trigger/API/approval capabilities must be inspected in the real workspace
 * before code is written against them (see docs/integrations/AGENTICORG_SETUP.md).
 * No agent run, contextual question or approval is ever fabricated.
 */
import type { AppConfig } from "../config";
import type { HealthResult } from "./posthog";

export interface SessionSummaryForQuestion {
  sessionPublicId: string;
  task: string;
  outcome: "completed" | "dropped" | "pending" | "invalid";
  pagesVisited: string[];
  notableObservations: { eventId: string; description: string }[];
}

export interface ContextualQuestion {
  question: string;
  evidenceEventId: string | null;
  externalRunId: string;
}

export interface EvidencePackage {
  studyPublicId: string;
  snapshotId: string;
  definition: { task: string; goalType: string; goalTarget: string; version: number };
  metrics: unknown;
  sessions: { sessionId: string; status: string; events: unknown[]; feedback: unknown[] }[];
}

export interface AnalysisRunStatus {
  externalRunId: string;
  status: "queued" | "running" | "draft_ready" | "approval_pending" | "approved" | "rejected" | "failed";
  output?: unknown;
  approvalId?: string;
  error?: string;
}

export interface UxDirectorProvider {
  readonly name: "agenticorg";
  readonly configured: boolean;
  /** True only once a live implementation exists and has been verified. */
  readonly implemented: boolean;
  missingKeys(): string[];
  generateContextualQuestion(summary: SessionSummaryForQuestion, opts: { timeoutMs: number }): Promise<ContextualQuestion | null>;
  startAnalysis(pkg: EvidencePackage): Promise<{ externalRunId: string }>;
  getRunStatus(externalRunId: string): Promise<AnalysisRunStatus>;
  /** Confirms an approval decision recorded in AgenticOrg's own HITL system. */
  getApproval(approvalId: string): Promise<{ approvalId: string; decision: "approved" | "rejected" | "pending"; reviewer: string | null }>;
  healthCheck(): Promise<HealthResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
  }
}

export class AgenticOrgAdapter implements UxDirectorProvider {
  readonly name = "agenticorg" as const;
  readonly implemented = false;

  constructor(private readonly config: Pick<AppConfig, "AGENTICORG_BASE_URL" | "AGENTICORG_API_KEY" | "AGENTICORG_WORKFLOW_ID">) {}

  get configured(): boolean {
    return this.missingKeys().length === 0;
  }

  missingKeys(): string[] {
    const keys: [string, unknown][] = [
      ["AGENTICORG_BASE_URL", this.config.AGENTICORG_BASE_URL],
      ["AGENTICORG_API_KEY", this.config.AGENTICORG_API_KEY],
      ["AGENTICORG_WORKFLOW_ID", this.config.AGENTICORG_WORKFLOW_ID],
    ];
    return keys.filter(([, v]) => !v).map(([k]) => k);
  }

  private unavailable(): never {
    if (!this.configured) throw new ProviderUnavailableError("agenticorg", "The UX Director (AgenticOrg) isn't connected.");
    throw new ProviderUnavailableError(
      "agenticorg",
      "AgenticOrg credentials are set, but the live connector hasn't been implemented against the verified workspace API yet.",
    );
  }

  async generateContextualQuestion(): Promise<ContextualQuestion | null> {
    // Callers fall back to the neutral standard question when this returns null.
    return null;
  }

  async startAnalysis(): Promise<{ externalRunId: string }> {
    this.unavailable();
  }

  async getRunStatus(): Promise<AnalysisRunStatus> {
    this.unavailable();
  }

  async getApproval(): Promise<{ approvalId: string; decision: "approved" | "rejected" | "pending"; reviewer: string | null }> {
    this.unavailable();
  }

  async healthCheck(): Promise<HealthResult> {
    if (!this.configured) {
      return { ok: false, status: "not_configured", message: `Missing: ${this.missingKeys().join(", ")}` };
    }
    return {
      ok: false,
      status: "verification_pending",
      message: "Credentials are present. Implement and verify the connector against the real workspace (\"Connect AgenticOrg\").",
    };
  }
}
