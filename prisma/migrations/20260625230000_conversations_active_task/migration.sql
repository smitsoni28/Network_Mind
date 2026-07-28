-- Add workspace-scoped conversations and persisted active-task state.
-- This migration is additive so databases with the older conversation pilot
-- tables keep their stored messages while receiving the canonical JSON state.
CREATE TABLE IF NOT EXISTS "Conversation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "activeTask" JSONB,
  "taskHistory" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "lastAnalysisRunId" TEXT,

  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConversationMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT,
  "role" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'TEXT',
  "intent" TEXT,
  "structuredPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "activeTask" JSONB;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "taskHistory" JSONB;
UPDATE "Conversation" SET "taskHistory" = '[]'::jsonb WHERE "taskHistory" IS NULL;
ALTER TABLE "Conversation" ALTER COLUMN "taskHistory" SET DEFAULT '[]';
ALTER TABLE "Conversation" ALTER COLUMN "taskHistory" SET NOT NULL;

ALTER TABLE "ConversationMessage" ALTER COLUMN "messageType" DROP DEFAULT;
ALTER TABLE "ConversationMessage" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
ALTER TABLE "ConversationMessage" ALTER COLUMN "messageType" TYPE TEXT USING "messageType"::TEXT;
ALTER TABLE "ConversationMessage" ALTER COLUMN "messageType" SET DEFAULT 'TEXT';

CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_updatedAt_idx" ON "Conversation"("workspaceId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_archivedAt_idx" ON "Conversation"("workspaceId", "archivedAt");
CREATE INDEX IF NOT EXISTS "Conversation_createdByUserId_idx" ON "Conversation"("createdByUserId");
CREATE INDEX IF NOT EXISTS "ConversationMessage_workspaceId_conversationId_createdAt_idx" ON "ConversationMessage"("workspaceId", "conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationMessage_workspaceId_intent_idx" ON "ConversationMessage"("workspaceId", "intent");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_workspaceId_fkey') THEN
    ALTER TABLE "Conversation"
      ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_createdByUserId_fkey') THEN
    ALTER TABLE "Conversation"
      ADD CONSTRAINT "Conversation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_lastAnalysisRunId_fkey') THEN
    ALTER TABLE "Conversation"
      ADD CONSTRAINT "Conversation_lastAnalysisRunId_fkey" FOREIGN KEY ("lastAnalysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationMessage_conversationId_fkey') THEN
    ALTER TABLE "ConversationMessage"
      ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationMessage_workspaceId_fkey') THEN
    ALTER TABLE "ConversationMessage"
      ADD CONSTRAINT "ConversationMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationMessage_userId_fkey') THEN
    ALTER TABLE "ConversationMessage"
      ADD CONSTRAINT "ConversationMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
