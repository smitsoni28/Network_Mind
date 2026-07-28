-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RelationshipStrength" AS ENUM ('STRONG', 'WARM', 'COLD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InteractionChannel" AS ENUM ('EMAIL', 'PHONE', 'MEETING', 'MESSAGE', 'NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "InteractionDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'MUTUAL');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "QueryIntent" AS ENUM ('GENERAL_WEB', 'NETWORK_SEARCH', 'INTRODUCTION_PATH', 'MIXED_WEB_NETWORK', 'RECONNECT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('NETWORK', 'INTERACTION', 'EDGE', 'WEB');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webEnrichmentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dataProcessingConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "primaryEmail" TEXT,
    "normalizedEmail" TEXT,
    "primaryPhone" TEXT,
    "normalizedPhone" TEXT,
    "company" TEXT,
    "normalizedCompany" TEXT,
    "role" TEXT,
    "location" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "relationshipStrength" "RelationshipStrength" NOT NULL DEFAULT 'UNKNOWN',
    "lastContactAt" TIMESTAMP(3),
    "howMet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "channel" "InteractionChannel" NOT NULL,
    "direction" "InteractionDirection",
    "summary" TEXT NOT NULL,
    "outcome" TEXT,
    "followUpAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEdge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromContactId" TEXT NOT NULL,
    "toContactId" TEXT,
    "externalTargetName" TEXT,
    "externalTargetType" TEXT,
    "relationshipType" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB NOT NULL,
    "errorSummary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "intent" "QueryIntent" NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "relationshipScore" INTEGER NOT NULL,
    "evidenceConfidence" INTEGER NOT NULL,
    "actionabilityScore" INTEGER NOT NULL,
    "priorityScore" INTEGER NOT NULL,
    "reasoning" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "uncertainty" JSONB NOT NULL,
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "analysisRunId" TEXT,
    "contactId" TEXT,
    "interactionId" TEXT,
    "contactEdgeId" TEXT,
    "type" "EvidenceType" NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "detail" TEXT NOT NULL,
    "url" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3),
    "confidence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "query" TEXT,
    "useful" BOOLEAN NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_workspaceId_idx" ON "User"("workspaceId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_archivedAt_idx" ON "Contact"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_company_idx" ON "Contact"("workspaceId", "company");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_lastContactAt_idx" ON "Contact"("workspaceId", "lastContactAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_normalizedEmail_key" ON "Contact"("workspaceId", "normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_normalizedPhone_key" ON "Contact"("workspaceId", "normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_normalizedName_normalizedCompany_key" ON "Contact"("workspaceId", "normalizedName", "normalizedCompany");

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_contactId_occurredAt_idx" ON "Interaction"("workspaceId", "contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "ContactEdge_workspaceId_fromContactId_idx" ON "ContactEdge"("workspaceId", "fromContactId");

-- CreateIndex
CREATE INDEX "ContactEdge_workspaceId_toContactId_idx" ON "ContactEdge"("workspaceId", "toContactId");

-- CreateIndex
CREATE INDEX "ContactEdge_workspaceId_externalTargetName_idx" ON "ContactEdge"("workspaceId", "externalTargetName");

-- CreateIndex
CREATE INDEX "ImportJob_workspaceId_createdAt_idx" ON "ImportJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_workspaceId_createdAt_idx" ON "AnalysisRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_contactId_idx" ON "Recommendation"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_analysisRunId_contactId_key" ON "Recommendation"("analysisRunId", "contactId");

-- CreateIndex
CREATE INDEX "Evidence_workspaceId_analysisRunId_idx" ON "Evidence"("workspaceId", "analysisRunId");

-- CreateIndex
CREATE INDEX "Evidence_contactId_idx" ON "Evidence"("contactId");

-- CreateIndex
CREATE INDEX "Feedback_workspaceId_createdAt_idx" ON "Feedback"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEdge" ADD CONSTRAINT "ContactEdge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEdge" ADD CONSTRAINT "ContactEdge_fromContactId_fkey" FOREIGN KEY ("fromContactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEdge" ADD CONSTRAINT "ContactEdge_toContactId_fkey" FOREIGN KEY ("toContactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_contactEdgeId_fkey" FOREIGN KEY ("contactEdgeId") REFERENCES "ContactEdge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every relationship edge must identify exactly one stored or external target.
ALTER TABLE "ContactEdge" ADD CONSTRAINT "ContactEdge_target_check" CHECK (("toContactId" IS NOT NULL) <> ("externalTargetName" IS NOT NULL));
