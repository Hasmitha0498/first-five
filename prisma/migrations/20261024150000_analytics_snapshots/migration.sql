-- CreateEnum
CREATE TYPE "AnalyticsSnapshotStatus" AS ENUM ('ready', 'processing', 'unavailable');

-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" UUID NOT NULL,
    "studyId" UUID NOT NULL,
    "studyVersion" INTEGER NOT NULL,
    "status" "AnalyticsSnapshotStatus" NOT NULL DEFAULT 'processing',
    "cohortHash" TEXT NOT NULL DEFAULT '',
    "eventCutoff" TIMESTAMP(3),
    "details" JSONB NOT NULL DEFAULT '{}',
    "dataQuality" JSONB NOT NULL DEFAULT '{}',
    "signature" TEXT,
    "lastError" TEXT,
    "computedAt" TIMESTAMP(3),
    "refreshStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_snapshots_studyId_studyVersion_key" ON "analytics_snapshots"("studyId", "studyVersion");

-- AddForeignKey
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

