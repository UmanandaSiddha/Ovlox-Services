/*
  Warnings:

  - You are about to drop the column `assigneeId` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the `CodeChange` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[organizationId,provider,providerUserId]` on the table `Identity` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[autoDetectedFromId]` on the table `Task` will be added. If there are existing duplicate values, this will fail.
  - Made the column `dimension` on table `Embedding` required. This step will fail if there are existing NULL values in that column.
  - Changed the type of `type` on the `LlmOutput` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FeatureStatus" AS ENUM ('DISCOVERED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SentimentPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SemanticIntent" AS ENUM ('FIX_ISSUE', 'FEATURE_IN_PROGRESS', 'FEATURE_COMPLETE', 'BLOCKER', 'QUESTION', 'DECISION', 'UPDATE', 'REVIEW_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "LlmOutputType" AS ENUM ('SUMMARY', 'ANSWER', 'DAILY_REPORT', 'WEEKLY_REPORT', 'RISK_ALERT', 'FEATURE_SCORE', 'SENTIMENT_INSIGHT', 'CODE_QUALITY', 'SECURITY_ANALYSIS');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('PURCHASE', 'REFUND', 'USAGE', 'BONUS', 'ADJUSTMENT', 'SUBSCRIPTION', 'EXPIRY');

-- CreateEnum
CREATE TYPE "CreditTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'PAST_DUE', 'UNPAID', 'TRIALING');

-- CreateEnum
CREATE TYPE "LlmOperationType" AS ENUM ('EVENT_SUMMARY', 'CODE_QUALITY', 'SECURITY_ANALYSIS', 'SENTIMENT_ANALYSIS', 'CHAT_ANSWER', 'FEATURE_DETECTION', 'PROJECT_REPORT', 'EMBEDDING', 'DEBUG_FIX');

-- CreateEnum
CREATE TYPE "LlmUsageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('ORG', 'PROJECT', 'DIRECT', 'TASK_TEAM', 'RAG_CHAT');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('MANUAL', 'AUTO_DETECTED', 'IMPORTED');

-- DropForeignKey
ALTER TABLE "CodeChange" DROP CONSTRAINT "CodeChange_rawEventId_fkey";

-- DropForeignKey
ALTER TABLE "Embedding" DROP CONSTRAINT "Embedding_llmOutputId_fkey";

-- DropForeignKey
ALTER TABLE "LlmOutput" DROP CONSTRAINT "LlmOutput_projectId_fkey";

-- DropForeignKey
ALTER TABLE "RawEvent" DROP CONSTRAINT "RawEvent_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_assigneeId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_projectId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "Embedding" ADD COLUMN     "contentChunkId" TEXT,
ADD COLUMN     "model" TEXT,
ALTER COLUMN "llmOutputId" DROP NOT NULL,
ALTER COLUMN "dimension" SET NOT NULL;

-- AlterTable
ALTER TABLE "LlmOutput" DROP COLUMN "type",
ADD COLUMN     "type" "LlmOutputType" NOT NULL;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "creditBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditLimit" DECIMAL(15,2),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RawEvent" ADD COLUMN     "authorMemberId" TEXT,
ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "channelName" TEXT,
ADD COLUMN     "messageType" TEXT,
ADD COLUMN     "parentMessageId" TEXT,
ADD COLUMN     "referencedIssueIds" JSONB,
ADD COLUMN     "semanticIntent" "SemanticIntent",
ADD COLUMN     "semanticSummary" TEXT,
ADD COLUMN     "threadId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "assigneeId",
ADD COLUMN     "autoDetectedByMemberId" TEXT,
ADD COLUMN     "autoDetectedFromId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedByMemberId" TEXT,
ADD COLUMN     "completionDeadline" TIMESTAMP(3),
ADD COLUMN     "isOverdue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "TaskSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "integrationId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- DropTable
DROP TABLE "CodeChange";

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "teamId" TEXT,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTeam" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" TEXT,
    "contributions" JSONB,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "TaskTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRawEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "rawEventId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskRawEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL DEFAULT 'RAG_CHAT',
    "projectId" TEXT,
    "organizationId" TEXT,
    "taskId" TEXT,
    "title" TEXT,
    "createdBy" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL DEFAULT 'USER',
    "content" TEXT NOT NULL,
    "senderId" TEXT,
    "senderMemberId" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mentionedUserId" TEXT NOT NULL,
    "mentionedMemberId" TEXT,
    "position" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessageSource" (
    "id" TEXT NOT NULL,
    "chatMessageId" TEXT NOT NULL,
    "rawEventId" TEXT,
    "llmOutputId" TEXT,
    "relevanceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FeatureStatus" NOT NULL DEFAULT 'DISCOVERED',
    "autoDetected" BOOLEAN NOT NULL DEFAULT true,
    "detectedById" TEXT,
    "autoDetectedByMemberId" TEXT,
    "completionDate" TIMESTAMP(3),
    "completedByMemberId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureEvent" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "rawEventId" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentimentReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodType" "SentimentPeriod" NOT NULL DEFAULT 'DAILY',
    "source" "ExternalProvider" NOT NULL,
    "channelId" TEXT,
    "repoId" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "fixIssueCount" INTEGER NOT NULL DEFAULT 0,
    "featureProgressCount" INTEGER NOT NULL DEFAULT 0,
    "featureCompleteCount" INTEGER NOT NULL DEFAULT 0,
    "blockerCount" INTEGER NOT NULL DEFAULT 0,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "decisionCount" INTEGER NOT NULL DEFAULT 0,
    "updateCount" INTEGER NOT NULL DEFAULT 0,
    "otherCount" INTEGER NOT NULL DEFAULT 0,
    "keyTopics" JSONB,
    "trendingIssues" JSONB,
    "insights" TEXT,
    "trends" JSONB,
    "projectReportId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentimentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentChunk" (
    "id" TEXT NOT NULL,
    "rawEventId" TEXT NOT NULL,
    "llmOutputId" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL DEFAULT 'DAILY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "highlights" JSONB,
    "metrics" JSONB,
    "featuresStatus" JSONB,
    "tasksStatus" JSONB,
    "llmOutputId" TEXT,
    "generatedById" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "status" "CreditTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(15,2) NOT NULL,
    "balanceBefore" DECIMAL(15,2) NOT NULL,
    "balanceAfter" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "metadata" JSONB,
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "refundedPaymentId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentId" TEXT,
    "llmUsageId" TEXT,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripePaymentId" TEXT,
    "stripeChargeId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "creditsAmount" DECIMAL(15,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "metadata" JSONB,
    "failureReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundAmount" DECIMAL(10,2),
    "processedAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "planName" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "monthlyCredits" DECIMAL(15,2),
    "lastCreditsGrantedPeriod" TIMESTAMP(3),
    "creditsGranted" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operationType" "LlmOperationType" NOT NULL,
    "creditsConsumed" DECIMAL(15,4) NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "model" TEXT,
    "costPerCredit" DECIMAL(10,6),
    "status" "LlmUsageStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAssignment_taskId_isActive_idx" ON "TaskAssignment"("taskId", "isActive");

-- CreateIndex
CREATE INDEX "TaskAssignment_assigneeId_isActive_idx" ON "TaskAssignment"("assigneeId", "isActive");

-- CreateIndex
CREATE INDEX "TaskAssignment_teamId_isActive_idx" ON "TaskAssignment"("teamId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTeam_taskId_key" ON "TaskTeam"("taskId");

-- CreateIndex
CREATE INDEX "TaskTeamMember_teamId_idx" ON "TaskTeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TaskTeamMember_memberId_idx" ON "TaskTeamMember"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTeamMember_teamId_memberId_key" ON "TaskTeamMember"("teamId", "memberId");

-- CreateIndex
CREATE INDEX "TaskRawEvent_taskId_idx" ON "TaskRawEvent"("taskId");

-- CreateIndex
CREATE INDEX "TaskRawEvent_rawEventId_idx" ON "TaskRawEvent"("rawEventId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRawEvent_taskId_rawEventId_key" ON "TaskRawEvent"("taskId", "rawEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_taskId_key" ON "Conversation"("taskId");

-- CreateIndex
CREATE INDEX "Conversation_projectId_type_idx" ON "Conversation"("projectId", "type");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_type_idx" ON "Conversation"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Conversation_type_taskId_idx" ON "Conversation"("type", "taskId");

-- CreateIndex
CREATE INDEX "Conversation_updated_at_idx" ON "Conversation"("updated_at");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_idx" ON "ConversationParticipant"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_leftAt_idx" ON "ConversationParticipant"("conversationId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_userId_key" ON "ConversationParticipant"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_created_at_idx" ON "ChatMessage"("conversationId", "created_at");

-- CreateIndex
CREATE INDEX "ChatMessage_senderId_idx" ON "ChatMessage"("senderId");

-- CreateIndex
CREATE INDEX "ChatMessage_senderMemberId_idx" ON "ChatMessage"("senderMemberId");

-- CreateIndex
CREATE INDEX "ChatMention_messageId_idx" ON "ChatMention"("messageId");

-- CreateIndex
CREATE INDEX "ChatMention_mentionedUserId_idx" ON "ChatMention"("mentionedUserId");

-- CreateIndex
CREATE INDEX "ChatMention_mentionedMemberId_idx" ON "ChatMention"("mentionedMemberId");

-- CreateIndex
CREATE INDEX "ChatMessageSource_chatMessageId_idx" ON "ChatMessageSource"("chatMessageId");

-- CreateIndex
CREATE INDEX "ChatMessageSource_rawEventId_idx" ON "ChatMessageSource"("rawEventId");

-- CreateIndex
CREATE INDEX "ChatMessageSource_llmOutputId_idx" ON "ChatMessageSource"("llmOutputId");

-- CreateIndex
CREATE INDEX "Feature_projectId_status_idx" ON "Feature"("projectId", "status");

-- CreateIndex
CREATE INDEX "Feature_autoDetectedByMemberId_idx" ON "Feature"("autoDetectedByMemberId");

-- CreateIndex
CREATE INDEX "Feature_completedByMemberId_idx" ON "Feature"("completedByMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_projectId_name_key" ON "Feature"("projectId", "name");

-- CreateIndex
CREATE INDEX "FeatureEvent_featureId_idx" ON "FeatureEvent"("featureId");

-- CreateIndex
CREATE INDEX "FeatureEvent_rawEventId_idx" ON "FeatureEvent"("rawEventId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureEvent_featureId_rawEventId_key" ON "FeatureEvent"("featureId", "rawEventId");

-- CreateIndex
CREATE INDEX "SentimentReport_projectId_periodEnd_idx" ON "SentimentReport"("projectId", "periodEnd");

-- CreateIndex
CREATE INDEX "SentimentReport_projectReportId_idx" ON "SentimentReport"("projectReportId");

-- CreateIndex
CREATE UNIQUE INDEX "SentimentReport_projectId_periodStart_periodEnd_periodType__key" ON "SentimentReport"("projectId", "periodStart", "periodEnd", "periodType", "source");

-- CreateIndex
CREATE INDEX "ContentChunk_rawEventId_chunkIndex_idx" ON "ContentChunk"("rawEventId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ContentChunk_llmOutputId_idx" ON "ContentChunk"("llmOutputId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReport_llmOutputId_key" ON "ProjectReport"("llmOutputId");

-- CreateIndex
CREATE INDEX "ProjectReport_projectId_periodEnd_idx" ON "ProjectReport"("projectId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReport_projectId_reportType_periodStart_periodEnd_key" ON "ProjectReport"("projectId", "reportType", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_llmUsageId_key" ON "CreditTransaction"("llmUsageId");

-- CreateIndex
CREATE INDEX "idx_credit_txn_org_created" ON "CreditTransaction"("organizationId", "created_at");

-- CreateIndex
CREATE INDEX "idx_credit_txn_org_type_status" ON "CreditTransaction"("organizationId", "type", "status");

-- CreateIndex
CREATE INDEX "idx_credit_txn_status" ON "CreditTransaction"("status");

-- CreateIndex
CREATE INDEX "idx_credit_txn_ref" ON "CreditTransaction"("referenceId", "referenceType");

-- CreateIndex
CREATE INDEX "CreditTransaction_refundedPaymentId_idx" ON "CreditTransaction"("refundedPaymentId");

-- CreateIndex
CREATE INDEX "CreditTransaction_processedById_idx" ON "CreditTransaction"("processedById");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_organizationId_key" ON "StripeCustomer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_stripeCustomerId_key" ON "StripeCustomer"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "StripeCustomer_stripeCustomerId_idx" ON "StripeCustomer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentId_key" ON "Payment"("stripePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeChargeId_key" ON "Payment"("stripeChargeId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_created_at_idx" ON "Payment"("organizationId", "created_at");

-- CreateIndex
CREATE INDEX "Payment_organizationId_status_idx" ON "Payment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Payment_stripePaymentId_idx" ON "Payment"("stripePaymentId");

-- CreateIndex
CREATE INDEX "Payment_stripeChargeId_idx" ON "Payment"("stripeChargeId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_status_idx" ON "Subscription"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Subscription_stripeSubscriptionId_idx" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "LlmUsage_organizationId_created_at_idx" ON "LlmUsage"("organizationId", "created_at");

-- CreateIndex
CREATE INDEX "LlmUsage_organizationId_operationType_idx" ON "LlmUsage"("organizationId", "operationType");

-- CreateIndex
CREATE INDEX "LlmUsage_operationType_created_at_idx" ON "LlmUsage"("operationType", "created_at");

-- CreateIndex
CREATE INDEX "LlmUsage_status_idx" ON "LlmUsage"("status");

-- CreateIndex
CREATE INDEX "LlmUsage_referenceId_referenceType_idx" ON "LlmUsage"("referenceId", "referenceType");

-- CreateIndex
CREATE INDEX "AuditLog_userId_created_at_idx" ON "AuditLog"("userId", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_created_at_idx" ON "AuditLog"("organizationId", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_action_created_at_idx" ON "AuditLog"("action", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- CreateIndex
CREATE INDEX "Embedding_llmOutputId_idx" ON "Embedding"("llmOutputId");

-- CreateIndex
CREATE INDEX "Embedding_contentChunkId_idx" ON "Embedding"("contentChunkId");

-- CreateIndex
CREATE INDEX "Embedding_vectorRef_idx" ON "Embedding"("vectorRef");

-- CreateIndex
CREATE INDEX "Identity_organizationId_idx" ON "Identity"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Identity_organizationId_provider_providerUserId_key" ON "Identity"("organizationId", "provider", "providerUserId");

-- CreateIndex
CREATE INDEX "RawEvent_projectId_idx" ON "RawEvent"("projectId");

-- CreateIndex
CREATE INDEX "RawEvent_authorIdentityId_idx" ON "RawEvent"("authorIdentityId");

-- CreateIndex
CREATE INDEX "RawEvent_authorMemberId_idx" ON "RawEvent"("authorMemberId");

-- CreateIndex
CREATE INDEX "RawEvent_source_sourceId_idx" ON "RawEvent"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_autoDetectedFromId_key" ON "Task"("autoDetectedFromId");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_completionDeadline_idx" ON "Task"("completionDeadline");

-- CreateIndex
CREATE INDEX "Task_isOverdue_status_idx" ON "Task"("isOverdue", "status");

-- CreateIndex
CREATE INDEX "Task_autoDetectedFromId_idx" ON "Task"("autoDetectedFromId");

-- CreateIndex
CREATE INDEX "Task_autoDetectedByMemberId_idx" ON "Task"("autoDetectedByMemberId");

-- CreateIndex
CREATE INDEX "Task_completedByMemberId_idx" ON "Task"("completedByMemberId");

-- CreateIndex
CREATE INDEX "WebhookEvent_organizationId_processed_idx" ON "WebhookEvent"("organizationId", "processed");

-- CreateIndex
CREATE INDEX "WebhookEvent_integrationId_idx" ON "WebhookEvent"("integrationId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_autoDetectedFromId_fkey" FOREIGN KEY ("autoDetectedFromId") REFERENCES "RawEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_autoDetectedByMemberId_fkey" FOREIGN KEY ("autoDetectedByMemberId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_completedByMemberId_fkey" FOREIGN KEY ("completedByMemberId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TaskTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTeam" ADD CONSTRAINT "TaskTeam_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTeamMember" ADD CONSTRAINT "TaskTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TaskTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTeamMember" ADD CONSTRAINT "TaskTeamMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRawEvent" ADD CONSTRAINT "TaskRawEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRawEvent" ADD CONSTRAINT "TaskRawEvent_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawEvent" ADD CONSTRAINT "RawEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawEvent" ADD CONSTRAINT "RawEvent_authorIdentityId_fkey" FOREIGN KEY ("authorIdentityId") REFERENCES "Identity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawEvent" ADD CONSTRAINT "RawEvent_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmOutput" ADD CONSTRAINT "LlmOutput_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_llmOutputId_fkey" FOREIGN KEY ("llmOutputId") REFERENCES "LlmOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_contentChunkId_fkey" FOREIGN KEY ("contentChunkId") REFERENCES "ContentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderMemberId_fkey" FOREIGN KEY ("senderMemberId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMention" ADD CONSTRAINT "ChatMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMention" ADD CONSTRAINT "ChatMention_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMention" ADD CONSTRAINT "ChatMention_mentionedMemberId_fkey" FOREIGN KEY ("mentionedMemberId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageSource" ADD CONSTRAINT "ChatMessageSource_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageSource" ADD CONSTRAINT "ChatMessageSource_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageSource" ADD CONSTRAINT "ChatMessageSource_llmOutputId_fkey" FOREIGN KEY ("llmOutputId") REFERENCES "LlmOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_detectedById_fkey" FOREIGN KEY ("detectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_autoDetectedByMemberId_fkey" FOREIGN KEY ("autoDetectedByMemberId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_completedByMemberId_fkey" FOREIGN KEY ("completedByMemberId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureEvent" ADD CONSTRAINT "FeatureEvent_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureEvent" ADD CONSTRAINT "FeatureEvent_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentimentReport" ADD CONSTRAINT "SentimentReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentimentReport" ADD CONSTRAINT "SentimentReport_projectReportId_fkey" FOREIGN KEY ("projectReportId") REFERENCES "ProjectReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_llmOutputId_fkey" FOREIGN KEY ("llmOutputId") REFERENCES "LlmOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReport" ADD CONSTRAINT "ProjectReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReport" ADD CONSTRAINT "ProjectReport_llmOutputId_fkey" FOREIGN KEY ("llmOutputId") REFERENCES "LlmOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReport" ADD CONSTRAINT "ProjectReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_refundedPaymentId_fkey" FOREIGN KEY ("refundedPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_llmUsageId_fkey" FOREIGN KEY ("llmUsageId") REFERENCES "LlmUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_stripeCustomerId_fkey" FOREIGN KEY ("stripeCustomerId") REFERENCES "StripeCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_stripeCustomerId_fkey" FOREIGN KEY ("stripeCustomerId") REFERENCES "StripeCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
