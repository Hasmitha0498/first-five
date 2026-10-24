-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "GrantSource" AS ENUM ('invitation_code', 'payment', 'admin');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('setup_not_started', 'awaiting_connection', 'verification_needed', 'connected', 'connection_issue');

-- CreateEnum
CREATE TYPE "SetupSessionStatus" AS ENUM ('active', 'finished', 'expired');

-- CreateEnum
CREATE TYPE "SdkTicketKind" AS ENUM ('setup_launch', 'live_launch', 'feedback');

-- CreateEnum
CREATE TYPE "SdkMode" AS ENUM ('setup', 'live');

-- CreateEnum
CREATE TYPE "StudyStatus" AS ENUM ('draft', 'ready', 'active', 'paused', 'full', 'closed', 'expired');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('element_clicked', 'page_reached', 'custom_event');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('pending', 'completed', 'dropped', 'invalid');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('not_prompted', 'awaiting', 'submitted', 'skipped', 'unavailable');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('not_generated', 'processing', 'draft', 'awaiting_review', 'revision_requested', 'approved', 'rejected', 'published', 'failed');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('created', 'checkout_ready', 'pending_verification', 'paid_verified', 'failed', 'cancelled', 'refunded', 'verification_error');

-- CreateEnum
CREATE TYPE "PaymentEnvironment" AS ENUM ('uat', 'live');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('not_configured', 'configured', 'verification_pending', 'verified', 'error');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'delivered', 'failed', 'dead');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_grants" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planKey" TEXT NOT NULL,
    "source" "GrantSource" NOT NULL,
    "studyCredits" INTEGER NOT NULL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "maxParticipantsPerStudy" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "orderId" UUID,
    "redemptionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_codes" (
    "id" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'judge',
    "planKey" TEXT NOT NULL,
    "studyCredits" INTEGER NOT NULL DEFAULT 1,
    "participantCap" INTEGER NOT NULL DEFAULT 5,
    "maxRedemptions" INTEGER NOT NULL,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "grantDays" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_code_redemptions" (
    "id" UUID NOT NULL,
    "codeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_leads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "productDescription" TEXT,
    "productUrl" TEXT,
    "source" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "referrer" TEXT,
    "noticeVersion" TEXT NOT NULL,
    "submissionCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "visitorId" TEXT,
    "userId" UUID,
    "environment" TEXT NOT NULL,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "websiteUrl" TEXT NOT NULL,
    "canonicalOrigin" TEXT NOT NULL,
    "integrationStatus" "IntegrationStatus" NOT NULL DEFAULT 'setup_not_started',
    "lastSdkVersion" TEXT,
    "lastConfigPingAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "firstConnectedAt" TIMESTAMP(3),
    "lastIssue" TEXT,
    "lastIssueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_origins" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_origins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_sdk_configs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "setupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxBatchEvents" INTEGER NOT NULL DEFAULT 50,
    "allowedCustomEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_sdk_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_sessions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "status" "SetupSessionStatus" NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "eventCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "setup_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sdk_tickets" (
    "id" UUID NOT NULL,
    "kind" "SdkTicketKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "setupSessionId" UUID,
    "studySessionId" UUID,
    "allowedOrigin" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdk_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sdk_credentials" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mode" "SdkMode" NOT NULL,
    "projectId" UUID NOT NULL,
    "setupSessionId" UUID,
    "studySessionId" UUID,
    "origin" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdk_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_pages" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSetupSessionId" UUID,

    CONSTRAINT "discovered_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_elements" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pagePath" TEXT NOT NULL,
    "elementKey" TEXT NOT NULL,
    "elementType" TEXT NOT NULL,
    "safeLabel" TEXT,
    "wasClicked" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSetupSessionId" UUID,

    CONSTRAINT "discovered_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_custom_events" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "eventName" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovered_custom_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studies" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StudyStatus" NOT NULL DEFAULT 'draft',
    "participantLimit" INTEGER NOT NULL DEFAULT 5,
    "creditGrantId" UUID,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "launchedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_versions" (
    "id" UUID NOT NULL,
    "studyId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "task" TEXT NOT NULL,
    "startPath" TEXT NOT NULL,
    "startVerified" BOOLEAN NOT NULL DEFAULT false,
    "goalType" "GoalType" NOT NULL,
    "goalTarget" TEXT NOT NULL,
    "goalPagePath" TEXT,
    "goalVerified" BOOLEAN NOT NULL DEFAULT false,
    "timeLimitSeconds" INTEGER NOT NULL DEFAULT 300,
    "milestones" JSONB NOT NULL DEFAULT '[]',
    "repeatPolicy" TEXT NOT NULL DEFAULT 'flag_repeats',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_invites" (
    "id" UUID NOT NULL,
    "studyId" UUID NOT NULL,
    "participantKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "maxEligibleAttempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_sessions" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "studyId" UUID NOT NULL,
    "studyVersionId" UUID NOT NULL,
    "inviteId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'pending',
    "isRepeat" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentTextVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "launchExchangedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "goalVerifiedAt" TIMESTAMP(3),
    "verifiedGoalEventId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalReason" TEXT,
    "dataQualityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feedbackStatus" "FeedbackStatus" NOT NULL DEFAULT 'not_prompted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_event_receipts" (
    "id" UUID NOT NULL,
    "studySessionId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "eventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "detail" JSONB,

    CONSTRAINT "critical_event_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_records" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "mode" "SdkMode" NOT NULL,
    "setupSessionId" UUID,
    "studySessionId" UUID,
    "eventName" TEXT NOT NULL,
    "clientSequence" INTEGER,
    "clientTimestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagePath" TEXT,
    "elementKey" TEXT,
    "elementType" TEXT,
    "elementLabel" TEXT,
    "properties" JSONB,
    "purgeAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_questions" (
    "id" UUID NOT NULL,
    "studySessionId" UUID NOT NULL,
    "questionKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "agentRunId" UUID,
    "displayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_responses" (
    "id" UUID NOT NULL,
    "studySessionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "choice" TEXT,
    "text" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "studyId" UUID NOT NULL,
    "studyVersion" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "metricsSnapshot" JSONB NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "agentRunId" UUID,
    "shareToken" TEXT,
    "publishedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_findings" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "observed" TEXT NOT NULL,
    "quotes" JSONB NOT NULL DEFAULT '[]',
    "interpretation" TEXT,
    "evidenceStrength" TEXT NOT NULL DEFAULT 'inconclusive',
    "suggestion" TEXT,
    "retestMetric" TEXT,
    "supportingSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "counterSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_approvals" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "reportRevision" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "externalApprovalId" TEXT,
    "reviewerId" UUID,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "studyId" UUID,
    "studySessionId" UUID,
    "externalRunId" TEXT,
    "status" TEXT NOT NULL,
    "inputDigest" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'pinelabs',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "environment" "PaymentEnvironment" NOT NULL,
    "merchantReference" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "providerPaymentId" TEXT,
    "providerEventId" TEXT,
    "providerStatus" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "provider" TEXT NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'not_configured',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "details" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "access_grants_orderId_key" ON "access_grants"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "access_grants_redemptionId_key" ON "access_grants"("redemptionId");

-- CreateIndex
CREATE INDEX "access_grants_userId_idx" ON "access_grants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_codes_codeHash_key" ON "invitation_codes"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_code_redemptions_codeId_userId_key" ON "invitation_code_redemptions"("codeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_leads_email_key" ON "waitlist_leads"("email");

-- CreateIndex
CREATE INDEX "waitlist_leads_createdAt_idx" ON "waitlist_leads"("createdAt");

-- CreateIndex
CREATE INDEX "conversion_events_name_createdAt_idx" ON "conversion_events"("name", "createdAt");

-- CreateIndex
CREATE INDEX "conversion_events_visitorId_idx" ON "conversion_events"("visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_publicId_key" ON "projects"("publicId");

-- CreateIndex
CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "project_origins_projectId_origin_key" ON "project_origins"("projectId", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "project_sdk_configs_projectId_key" ON "project_sdk_configs"("projectId");

-- CreateIndex
CREATE INDEX "setup_sessions_projectId_idx" ON "setup_sessions"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "sdk_tickets_tokenHash_key" ON "sdk_tickets"("tokenHash");

-- CreateIndex
CREATE INDEX "sdk_tickets_studySessionId_idx" ON "sdk_tickets"("studySessionId");

-- CreateIndex
CREATE UNIQUE INDEX "sdk_credentials_tokenHash_key" ON "sdk_credentials"("tokenHash");

-- CreateIndex
CREATE INDEX "sdk_credentials_studySessionId_idx" ON "sdk_credentials"("studySessionId");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_pages_projectId_path_key" ON "discovered_pages"("projectId", "path");

-- CreateIndex
CREATE INDEX "discovered_elements_projectId_elementKey_idx" ON "discovered_elements"("projectId", "elementKey");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_elements_projectId_pagePath_elementKey_key" ON "discovered_elements"("projectId", "pagePath", "elementKey");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_custom_events_projectId_eventName_key" ON "discovered_custom_events"("projectId", "eventName");

-- CreateIndex
CREATE UNIQUE INDEX "studies_publicId_key" ON "studies"("publicId");

-- CreateIndex
CREATE INDEX "studies_projectId_idx" ON "studies"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "study_versions_studyId_version_key" ON "study_versions"("studyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "participant_invites_participantKey_key" ON "participant_invites"("participantKey");

-- CreateIndex
CREATE UNIQUE INDEX "participant_invites_tokenHash_key" ON "participant_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "participant_invites_studyId_idx" ON "participant_invites"("studyId");

-- CreateIndex
CREATE UNIQUE INDEX "study_sessions_publicId_key" ON "study_sessions"("publicId");

-- CreateIndex
CREATE INDEX "study_sessions_studyId_status_idx" ON "study_sessions"("studyId", "status");

-- CreateIndex
CREATE INDEX "study_sessions_studyId_startedAt_idx" ON "study_sessions"("studyId", "startedAt");

-- CreateIndex
CREATE INDEX "study_sessions_status_deadlineAt_idx" ON "study_sessions"("status", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "critical_event_receipts_studySessionId_kind_key" ON "critical_event_receipts"("studySessionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "event_records_eventId_key" ON "event_records"("eventId");

-- CreateIndex
CREATE INDEX "event_records_studySessionId_clientSequence_idx" ON "event_records"("studySessionId", "clientSequence");

-- CreateIndex
CREATE INDEX "event_records_projectId_mode_receivedAt_idx" ON "event_records"("projectId", "mode", "receivedAt");

-- CreateIndex
CREATE INDEX "event_records_purgeAfter_idx" ON "event_records"("purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX "interview_questions_studySessionId_questionKey_key" ON "interview_questions"("studySessionId", "questionKey");

-- CreateIndex
CREATE INDEX "interview_responses_studySessionId_idx" ON "interview_responses"("studySessionId");

-- CreateIndex
CREATE UNIQUE INDEX "interview_responses_questionId_key" ON "interview_responses"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "reports_shareToken_key" ON "reports"("shareToken");

-- CreateIndex
CREATE INDEX "reports_studyId_idx" ON "reports"("studyId");

-- CreateIndex
CREATE INDEX "report_findings_reportId_idx" ON "report_findings"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "report_approvals_externalApprovalId_key" ON "report_approvals"("externalApprovalId");

-- CreateIndex
CREATE INDEX "report_approvals_reportId_decision_idx" ON "report_approvals"("reportId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_externalRunId_key" ON "agent_runs"("externalRunId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_merchantReference_key" ON "orders"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "orders_providerOrderId_key" ON "orders"("providerOrderId");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_externalEventId_key" ON "payment_webhook_events"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "outbox_messages_provider_status_nextAttemptAt_idx" ON "outbox_messages"("provider", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "outbox_messages_purgeAfter_idx" ON "outbox_messages"("purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_messages_provider_dedupeKey_key" ON "outbox_messages"("provider", "dedupeKey");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "invitation_code_redemptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_codes" ADD CONSTRAINT "invitation_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_code_redemptions" ADD CONSTRAINT "invitation_code_redemptions_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "invitation_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_code_redemptions" ADD CONSTRAINT "invitation_code_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_origins" ADD CONSTRAINT "project_origins_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_sdk_configs" ADD CONSTRAINT "project_sdk_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sessions" ADD CONSTRAINT "setup_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sessions" ADD CONSTRAINT "setup_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_tickets" ADD CONSTRAINT "sdk_tickets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_tickets" ADD CONSTRAINT "sdk_tickets_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_credentials" ADD CONSTRAINT "sdk_credentials_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_credentials" ADD CONSTRAINT "sdk_credentials_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_pages" ADD CONSTRAINT "discovered_pages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_elements" ADD CONSTRAINT "discovered_elements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_custom_events" ADD CONSTRAINT "discovered_custom_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_creditGrantId_fkey" FOREIGN KEY ("creditGrantId") REFERENCES "access_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_versions" ADD CONSTRAINT "study_versions_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_invites" ADD CONSTRAINT "participant_invites_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_studyVersionId_fkey" FOREIGN KEY ("studyVersionId") REFERENCES "study_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "participant_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_event_receipts" ADD CONSTRAINT "critical_event_receipts_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_records" ADD CONSTRAINT "event_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_records" ADD CONSTRAINT "event_records_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_responses" ADD CONSTRAINT "interview_responses_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_responses" ADD CONSTRAINT "interview_responses_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "interview_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_findings" ADD CONSTRAINT "report_findings_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

