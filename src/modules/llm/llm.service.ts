import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';
import OpenAI from 'openai';
import Decimal from 'decimal.js';
import { shouldSkipCreditChecks } from 'src/utils/environment.util';
import {
    LlmOperationType,
    LlmOutputType,
    LlmUsageStatus,
    SemanticIntent,
    ExternalProvider,
    RawEventType,
} from '../../../generated/prisma/enums';
import { Prisma } from '../../../generated/prisma/client';

/**
 * LLM Service - Single source of truth for all LLM operations
 * - Credit tracking with LlmUsage and CreditTransaction
 * - pgvector-based RAG for semantic search
 * - Embedding generation and storage
 * - All LLM operations (summarization, analysis, chat, etc.)
 */
@Injectable()
export class LlmService implements OnModuleInit {
    private readonly logger = new LoggerService(LlmService.name);
    private readonly openai: OpenAI;
    private readonly defaultModel = 'gpt-4o-mini';
    private readonly embeddingModel = 'text-embedding-3-small';
    private readonly timeoutMs = 45_000;

    // Credit costs configuration (hybrid: base + per-token)
    private readonly CREDIT_COSTS: Record<
        string,
        { base: number; inputPer1K?: number; outputPer1K?: number }
    > = {
        'gpt-4o-mini': { base: 0.001, inputPer1K: 0.00015, outputPer1K: 0.0006 },
        'gpt-4': { base: 0.03, inputPer1K: 0.03, outputPer1K: 0.06 },
        'gpt-3.5-turbo': { base: 0.002, inputPer1K: 0.0015, outputPer1K: 0.002 },
        'text-embedding-3-small': { base: 0.0001, inputPer1K: 0.02 }, // embeddings only have input
    };

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService
    ) {
        const openaiKey = this.configService.get<string>('OPENAI_API_KEY') || '';
        if (!openaiKey) {
            this.logger.warn('OPENAI_API_KEY not found; LLM calls will fail until configured.', LlmService.name);
        }
        this.openai = new OpenAI({ apiKey: openaiKey || 'missing' });
    }

    async onModuleInit() {
        try {
            // Verify pgvector extension and vector column exist
            // The extension and column should be created by migration: 20260111014551_add_pgvector_support
            await this.verifyPgVectorSetup();
            this.logger.log('LlmService initialized with pgvector support', LlmService.name);
        } catch (error) {
            this.logger.warn(`pgvector not available: ${error.message}. Vector similarity search will fall back to keyword search.`, LlmService.name);
            // Continue anyway - embeddings will fail but other operations work
        }
    }

    // ==================== Core Infrastructure Methods ====================

    /**
     * Verify pgvector extension and vector column are set up correctly
     * These should be created by migration: 20260111014551_add_pgvector_support
     * If not found, logs a warning but doesn't fail - allows graceful degradation
     */
    private async verifyPgVectorSetup(): Promise<void> {
        try {
            // Check if pgvector extension exists
            const extensionCheck = await this.databaseService.$queryRaw<Array<{ exists: boolean }>>`
                SELECT EXISTS(
                    SELECT 1 FROM pg_extension WHERE extname = 'vector'
                ) as exists
            `;

            if (!extensionCheck[0]?.exists) {
                throw new Error('pgvector extension not found. Please run migration: 20260111014551_add_pgvector_support');
            }

            // Check if vector column exists in Embedding table
            const columnCheck = await this.databaseService.$queryRaw<Array<{ exists: boolean }>>`
                SELECT EXISTS(
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'Embedding' AND column_name = 'vector'
                ) as exists
            `;

            if (!columnCheck[0]?.exists) {
                throw new Error('vector column not found in Embedding table. Please run migration: 20260111014551_add_pgvector_support');
            }

            this.logger.log('pgvector extension and vector column verified', LlmService.name);
        } catch (error) {
            // Re-throw to allow onModuleInit to catch and log as warning
            throw error;
        }
    }

    /**
     * Get organization from project
     */
    private async getOrganizationFromProject(projectId: string) {
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId },
            include: { organization: true },
        });
        if (!project || !project.organization) {
            throw new BadRequestException(`Project ${projectId} not found or has no organization`);
        }
        return project.organization;
    }

    /**
     * Calculate credits consumed based on model and token usage (hybrid: base + per-token)
     */
    private calculateCredits(model: string, inputTokens: number, outputTokens: number): Decimal {
        const costs = this.CREDIT_COSTS[model] || this.CREDIT_COSTS[this.defaultModel];
        const baseCredits = new Decimal(costs.base);
        const inputCredits = costs.inputPer1K
            ? new Decimal(inputTokens).div(1000).times(costs.inputPer1K)
            : new Decimal(0);
        const outputCredits = costs.outputPer1K
            ? new Decimal(outputTokens).div(1000).times(costs.outputPer1K)
            : new Decimal(0);
        return baseCredits.plus(inputCredits).plus(outputCredits);
    }

    /**
     * Check if organization has sufficient credits
     */
    private async checkCreditBalance(organizationId: string, requiredCredits: Decimal): Promise<boolean> {
        const org = await this.databaseService.organization.findUnique({
            where: { id: organizationId },
            select: { creditBalance: true, creditLimit: true },
        });
        if (!org) return false;

        const availableCredits = org.creditLimit
            ? Decimal.min(org.creditBalance, org.creditLimit)
            : org.creditBalance;

        return availableCredits.gte(requiredCredits);
    }

    /**
     * Atomically deduct credits with optimistic locking
     */
    private async deductCreditsAtomically(
        organizationId: string,
        credits: Decimal,
        llmUsageId: string
    ): Promise<Prisma.CreditTransactionGetPayload<{}>> {
        return this.databaseService.$transaction(async (tx) => {
            const org = await tx.organization.findUnique({
                where: { id: organizationId },
                select: { id: true, creditBalance: true, version: true },
            });

            if (!org) {
                throw new BadRequestException(`Organization ${organizationId} not found`);
            }

            if (org.creditBalance.lt(credits)) {
                throw new BadRequestException('Insufficient credits');
            }

            const newBalance = org.creditBalance.minus(credits);
            const balanceBefore = org.creditBalance;
            const balanceAfter = newBalance;

            const [updatedOrg, creditTxn] = await Promise.all([
                tx.organization.update({
                    where: { id: organizationId, version: org.version },
                    data: {
                        creditBalance: newBalance,
                        version: { increment: 1 },
                    },
                }),
                tx.creditTransaction.create({
                    data: {
                        organizationId,
                        type: 'USAGE',
                        status: 'COMPLETED',
                        amount: credits.negated(), // Negative for usage
                        balanceBefore,
                        balanceAfter,
                        llmUsageId,
                        referenceType: 'llm_usage',
                        referenceId: llmUsageId,
                        processedAt: new Date(),
                    },
                }),
            ]);

            this.logger.log(
                `Credits deducted: ${credits.toString()} from org ${organizationId}. New balance: ${newBalance.toString()}`,
                LlmService.name
            );

            return creditTxn;
        });
    }

    /**
     * Extract JSON from LLM response (handles markdown code blocks)
     */
    private extractJson<T>(text: string): T {
        if (!text || typeof text !== 'string') {
            throw new Error('LLM returned empty response');
        }

        const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();

        try {
            return JSON.parse(cleaned) as T;
        } catch {
            // Try to extract JSON object from text
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (!match) {
                throw new Error('No JSON object found in LLM output');
            }
            return JSON.parse(match[0]) as T;
        }
    }

    /**
     * Generate text using OpenAI (low-level method)
     */
    private async generateText(
        systemPrompt: string,
        userPrompt: string,
        options: { model?: string; temperature?: number; maxTokens?: number } = {}
    ): Promise<string> {
        const { model = this.defaultModel, temperature = 0.3, maxTokens = 600 } = options;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await this.openai.chat.completions.create(
                {
                    model,
                    temperature,
                    max_tokens: maxTokens,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                },
                { signal: controller.signal }
            );

            return res.choices[0]?.message?.content?.trim() ?? '';
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('LLM request timed out');
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Generate JSON response using OpenAI (low-level method)
     */
    private async generateJson<T>(
        systemPrompt: string,
        userPrompt: string,
        options: { model?: string; maxTokens?: number } = {}
    ): Promise<T> {
        const raw = await this.generateText(systemPrompt, userPrompt, {
            temperature: 0,
            maxTokens: options.maxTokens ?? 800,
        });

        try {
            return this.extractJson<T>(raw);
        } catch (err) {
            this.logger.error(`Invalid JSON from LLM: ${raw}`, LlmService.name);
            throw new Error('LLM returned invalid JSON');
        }
    }

    /**
     * Core LLM operation wrapper with credit tracking
     * Creates LlmUsage, checks credits, executes LLM call, tracks usage, deducts credits atomically
     */
    private async executeLlmOperation<T>(params: {
        organizationId: string;
        operationType: LlmOperationType;
        model?: string;
        systemPrompt: string;
        userPrompt: string;
        maxTokens?: number;
        temperature?: number;
        returnType?: 'text' | 'json';
        referenceId?: string;
        referenceType?: string;
    }): Promise<{
        result: T;
        usage: { inputTokens: number; outputTokens: number; totalTokens: number };
        llmUsageId: string;
    }> {
        const {
            organizationId,
            operationType,
            model = this.defaultModel,
            systemPrompt,
            userPrompt,
            maxTokens = 600,
            temperature = 0.3,
            returnType = 'text',
            referenceId,
            referenceType,
        } = params;

        // 1. Estimate credits needed (use maxTokens for estimation)
        const estimatedCredits = this.calculateCredits(model, maxTokens, Math.floor(maxTokens * 0.5));
        const hasCredits = await this.checkCreditBalance(organizationId, estimatedCredits);
        if (!hasCredits) {
            throw new BadRequestException('Insufficient credits for this operation');
        }

        // 2. Create LlmUsage record (PENDING status)
        const llmUsage = await this.databaseService.llmUsage.create({
            data: {
                organizationId,
                operationType,
                creditsConsumed: new Decimal(0), // Will update after execution
                status: 'PENDING',
                model,
                referenceId,
                referenceType,
            },
        });

        let result: T;
        let inputTokens = 0;
        let outputTokens = 0;
        let totalTokens = 0;

        try {
            // 3. Execute LLM operation
            if (returnType === 'json') {
                result = await this.generateJson<T>(systemPrompt, userPrompt, { model, maxTokens });
            } else {
                result = (await this.generateText(systemPrompt, userPrompt, {
                    model,
                    temperature,
                    maxTokens,
                })) as T;
            }

            // 4. Get actual token usage (estimate if not available from API)
            // Note: OpenAI API returns usage in response, but we're using estimate here
            // For more accuracy, capture from response.choices[0].usage
            const promptTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4); // Rough estimate
            inputTokens = promptTokens;
            outputTokens = returnType === 'json' ? Math.ceil(JSON.stringify(result).length / 4) : Math.ceil(String(result).length / 4);
            totalTokens = inputTokens + outputTokens;

            // 5. Calculate actual credits consumed
            const actualCredits = this.calculateCredits(model, inputTokens, outputTokens);

            // 6. Update LlmUsage with actual usage and mark as COMPLETED
            await this.databaseService.llmUsage.update({
                where: { id: llmUsage.id },
                data: {
                    creditsConsumed: actualCredits,
                    inputTokens,
                    outputTokens,
                    totalTokens,
                    status: 'COMPLETED',
                    costPerCredit: actualCredits.div(totalTokens || 1),
                },
            });

            // 7. Atomically deduct credits
            await this.deductCreditsAtomically(organizationId, actualCredits, llmUsage.id);

            this.logger.log(
                `LLM operation ${operationType} completed. Credits: ${actualCredits.toString()}, Tokens: ${totalTokens}`,
                LlmService.name
            );

            return {
                result,
                usage: { inputTokens, outputTokens, totalTokens },
                llmUsageId: llmUsage.id,
            };
        } catch (error) {
            // Mark LlmUsage as FAILED
            await this.databaseService.llmUsage.update({
                where: { id: llmUsage.id },
                data: {
                    status: 'FAILED',
                    errorMessage: error.message || 'Unknown error',
                },
            });

            this.logger.error(`LLM operation ${operationType} failed: ${error.message}`, LlmService.name);
            throw error;
        }
    }

    // ==================== RawEvent Processing Methods ====================

    /**
     * Process a RawEvent - main entry point called by queue processor
     * Analyzes event type and routes to appropriate processing method
     */
    async processRawEvent(rawEventId: string) {
        const rawEvent = await this.databaseService.rawEvent.findUnique({
            where: { id: rawEventId },
            include: { project: { include: { organization: true } } },
        });

        if (!rawEvent) {
            throw new BadRequestException(`RawEvent ${rawEventId} not found`);
        }

        if (!rawEvent.project || !rawEvent.project.organization) {
            throw new BadRequestException(`RawEvent ${rawEventId} has no associated organization`);
        }

        const organizationId = rawEvent.project.organizationId;

        try {
            let summary: string;
            let semanticIntent: SemanticIntent | null = null;

            // Route based on event type
            const metadata = rawEvent.metadata as any;
            switch (rawEvent.eventType) {
                case 'COMMIT':
                case 'PULL_REQUEST':
                    summary = await this.summarizeCodeChange(
                        organizationId,
                        {
                            title: metadata?.title || metadata?.commitMessage || 'Code change',
                            description: metadata?.description || rawEvent.content,
                            files: metadata?.files || metadata?.filesChanged || [],
                        },
                        rawEventId
                    );
                    break;

                case 'MESSAGE':
                case 'ISSUE':
                    const messageResult = await this.summarizeMessage(
                        organizationId,
                        {
                            content: rawEvent.content || '',
                            title: metadata?.title || metadata?.subject,
                        },
                        rawEventId
                    );
                    summary = messageResult.summary;
                    semanticIntent = messageResult.semanticIntent;
                    break;

                default:
                    // Generic summarization for other event types
                    summary = await this.summarizeGenericEvent(
                        organizationId,
                        {
                            eventType: rawEvent.eventType,
                            content: rawEvent.content || '',
                            metadata,
                        },
                        rawEventId
                    );
            }

            // Create LlmOutput record
            const llmOutput = await this.databaseService.llmOutput.create({
            data: {
                    projectId: rawEvent.projectId,
                    rawEventId: rawEvent.id,
                    type: 'SUMMARY',
                content: summary,
                    model: this.defaultModel,
                    metadata: semanticIntent ? { semanticIntent } : undefined,
            },
        });

            // Generate and store embeddings for RAG
            if (rawEvent.content || summary) {
                await this.generateEmbeddingForRawEvent(rawEvent.id, organizationId, summary || rawEvent.content || '');
            }

            // Mark RawEvent as processed
            await this.databaseService.rawEvent.update({
                where: { id: rawEvent.id },
                data: { processedByLLM: true },
            });

            // Detect features and tasks from the event
            if (semanticIntent) {
                await this.detectFeatureFromRawEvent(rawEvent, semanticIntent);
            }

            this.logger.log(`Processed RawEvent ${rawEventId}`, LlmService.name);
            return llmOutput;
        } catch (error) {
            this.logger.error(`Failed to process RawEvent ${rawEventId}: ${error.message}`, LlmService.name);
            throw error;
        }
    }

    /**
     * Summarize code changes (commits, PRs) - Public method for external use
     */
    async summarizeCodeChange(
        organizationId: string,
        input: {
            title: string;
            description?: string | null;
            files: Array<{ filename: string; patch?: string | null }>;
        },
        referenceId?: string
    ): Promise<string> {
        const systemPrompt = `You are a senior software engineer.
        Summarize code changes clearly and concisely.
        Focus on intent, impact, and risk.
        Do NOT repeat code verbatim.
        Provide a 3-4 line summary.`;

        const userPrompt = `TITLE: ${input.title}

        ${input.description ? `DESCRIPTION: ${input.description}\n` : ''}

        FILES CHANGED:
        ${input.files
            .map((f) => `File: ${f.filename}\nChanges:\n${f.patch ?? 'Diff too large'}`)
            .join('\n\n')}

        Explain:
        1. What changed
        2. Why it matters
        3. Any risks`;

        const { result } = await this.executeLlmOperation<string>({
            organizationId,
            operationType: 'EVENT_SUMMARY',
            systemPrompt,
            userPrompt,
            maxTokens: 400,
            referenceId: referenceId || undefined,
            referenceType: referenceId ? 'code_change' : undefined,
            returnType: 'text',
        });

        return result;
    }

    /**
     * Summarize message/comment and analyze semantic intent
     */
    private async summarizeMessage(
        organizationId: string,
        input: { content: string; title?: string | null },
        referenceId: string
    ): Promise<{ summary: string; semanticIntent: SemanticIntent | null }> {
        const systemPrompt = `You are analyzing project communications (messages, comments, issues).
        Summarize the message and determine its semantic intent regarding the project.

        Return JSON in this exact format:
        {
        "summary": "brief summary of what the user said",
        "semanticIntent": "FEATURE_REQUEST" | "BUG_REPORT" | "TASK_UPDATE" | "QUESTION" | "ANNOUNCEMENT" | "OTHER" | null,
        "projectContext": "what project aspect is being discussed (e.g., 'authentication feature', 'login bug')"
        }

        Rules:
        - semanticIntent should be null if unclear
        - projectContext should identify what part of the project is mentioned
        - summary should be concise (2-3 sentences)`;

        const userPrompt = `${input.title ? `TITLE: ${input.title}\n\n` : ''}MESSAGE:
        ${input.content}`;

        type MessageAnalysis = {
            summary: string;
            semanticIntent: SemanticIntent | null;
            projectContext: string;
        };

        const { result } = await this.executeLlmOperation<MessageAnalysis>({
            organizationId,
            operationType: 'SENTIMENT_ANALYSIS',
            systemPrompt,
            userPrompt,
            maxTokens: 500,
            referenceId,
            referenceType: 'raw_event',
            returnType: 'json',
        });

        // Map string to enum if needed
        let intent: SemanticIntent | null = null;
        if (result.semanticIntent) {
            try {
                intent = result.semanticIntent as SemanticIntent;
            } catch {
                // Invalid enum value, keep as null
            }
        }

        return { summary: result.summary, semanticIntent: intent };
    }

    /**
     * Summarize generic event (fallback for unknown event types)
     */
    private async summarizeGenericEvent(
        organizationId: string,
        input: {
            eventType: RawEventType;
            content?: string | null;
            metadata?: any;
        },
        referenceId: string
    ): Promise<string> {
        const systemPrompt = `You are analyzing project events.
        Provide a concise summary (2-3 sentences) of what happened.`;

        const metadataStr = input.metadata ? JSON.stringify(input.metadata, null, 2) : '';
        const userPrompt = `EVENT TYPE: ${input.eventType}
        ${input.content ? `CONTENT: ${input.content}\n` : ''}
        ${metadataStr ? `METADATA: ${metadataStr}` : ''}`;

        const { result } = await this.executeLlmOperation<string>({
            organizationId,
            operationType: 'EVENT_SUMMARY',
            systemPrompt,
            userPrompt,
            maxTokens: 300,
            referenceId,
            referenceType: 'raw_event',
            returnType: 'text',
        });

        return result;
    }


    /**
     * Detect features from RawEvent based on semantic intent
     */
    private async detectFeatureFromRawEvent(
        rawEvent: any,
        semanticIntent: SemanticIntent | null
    ): Promise<void> {
        // Only detect features from certain semantic intents
        if (
            !semanticIntent ||
            !['FEATURE_REQUEST', 'TASK_UPDATE', 'ISSUE'].includes(semanticIntent) ||
            !rawEvent.projectId
        ) {
            return;
        }

        try {
            const projectId = rawEvent.projectId;
            const organizationId = rawEvent.project?.organizationId;

            if (!organizationId) {
                return;
            }

            // Analyze RawEvent content to extract feature information
            const systemPrompt = `You are analyzing project events to detect features being worked on.
Extract feature information from the event content.

Return JSON in this exact format:
{
  "featureName": string | null,  // e.g., "Authentication", "Payment Gateway", "User Dashboard"
  "description": string | null,  // Brief description of the feature
  "isNewFeature": boolean,       // true if this is a new feature being started
  "confidence": number           // 0-1 confidence score
}

Rules:
- featureName should be a concise, project-level feature name (e.g., "Auth", "Payments", "Dashboard")
- Only extract if confidence >= 0.7
- If unclear, return null for featureName
- DO NOT wrap in markdown or code blocks`;

            const userPrompt = `EVENT TYPE: ${rawEvent.eventType}
CONTENT: ${rawEvent.content || ''}
${rawEvent.metadata?.title ? `TITLE: ${rawEvent.metadata.title}` : ''}
${rawEvent.metadata?.description ? `DESCRIPTION: ${rawEvent.metadata.description}` : ''}

Extract feature information if this event relates to a specific feature being worked on.`;

            type FeatureDetection = {
                featureName: string | null;
                description: string | null;
                isNewFeature: boolean;
                confidence: number;
            };

            const { result } = await this.executeLlmOperation<FeatureDetection>({
                organizationId,
                operationType: 'FEATURE_DETECTION',
                systemPrompt,
                userPrompt,
                maxTokens: 300,
                referenceId: rawEvent.id,
                referenceType: 'raw_event',
                returnType: 'json',
            });

            // Only create feature if confidence is high and feature name exists
            if (result.confidence >= 0.7 && result.featureName) {
                // Check if feature already exists
                const existingFeature = await this.databaseService.feature.findUnique({
                    where: {
                        projectId_name: {
                            projectId,
                            name: result.featureName,
                        },
                    },
                });

                let featureId: string;

                if (existingFeature) {
                    featureId = existingFeature.id;
                } else if (result.isNewFeature) {
                    // Create new feature
                    const newFeature = await this.databaseService.feature.create({
                        data: {
                            projectId,
                            name: result.featureName,
                            description: result.description || null,
                            autoDetected: true,
                            autoDetectedByMemberId: rawEvent.authorMemberId || undefined,
                            status: 'DISCOVERED',
                        },
                    });
                    featureId = newFeature.id;
                    this.logger.log(`Auto-detected new feature: ${result.featureName} for project ${projectId}`, LlmService.name);
                } else {
                    // Feature mentioned but not new, skip
                    return;
                }

                // Link RawEvent to Feature via FeatureEvent
                await this.databaseService.featureEvent.upsert({
                    where: {
                        featureId_rawEventId: {
                            featureId,
                            rawEventId: rawEvent.id,
                        },
                    },
                    update: {
                        relevance: result.confidence,
                    },
                    create: {
                        featureId,
                        rawEventId: rawEvent.id,
                        relevance: result.confidence,
                    },
                });
            }
        } catch (error) {
            this.logger.error(`Feature detection failed for RawEvent ${rawEvent.id}: ${error.message}`, LlmService.name);
            // Don't throw - feature detection failure shouldn't block RawEvent processing
        }
    }

    /**
     * Generate project report summarizing what's being done
     */
    async generateProjectReport(params: {
        projectId: string;
        periodStart: Date;
        periodEnd: Date;
        reportType?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
        generatedById?: string;
    }): Promise<{
        reportId: string;
        summary: string;
        highlights: any;
        metrics: any;
    }> {
        const { projectId, periodStart, periodEnd, reportType = 'DAILY', generatedById } = params;

        // Get project and organization
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId },
            include: { organization: true },
        });

        if (!project || !project.organization) {
            throw new BadRequestException(`Project ${projectId} not found or has no organization`);
        }

        const organizationId = project.organizationId;

        try {
            // 1. Gather project data for the period
            const [recentRawEvents, recentTasks, recentFeatures, recentLlmOutputs] = await Promise.all([
                this.databaseService.rawEvent.findMany({
                    where: {
                        projectId,
                        timestamp: { gte: periodStart, lte: periodEnd },
                    },
                    take: 100,
                    orderBy: { timestamp: 'desc' },
                    include: { authorMember: true },
                }),
                this.databaseService.task.findMany({
                    where: {
                        projectId,
                        updatedAt: { gte: periodStart, lte: periodEnd },
                    },
                    take: 50,
                    include: { assignedTo: true },
                }),
                this.databaseService.feature.findMany({
            where: { projectId },
                    include: {
                        events: {
                            where: {
                                rawEvent: {
                                    timestamp: { gte: periodStart, lte: periodEnd },
                                },
                            },
                            take: 10,
                        },
                    },
                }),
                this.databaseService.llmOutput.findMany({
                    where: {
                        projectId,
                        createdAt: { gte: periodStart, lte: periodEnd },
                    },
                    take: 50,
            orderBy: { createdAt: 'desc' },
                }),
            ]);

            // 2. Calculate metrics
            const commits = recentRawEvents.filter((e) => e.eventType === 'COMMIT').length;
            const pullRequests = recentRawEvents.filter((e) => e.eventType === 'PULL_REQUEST').length;
            const issues = recentRawEvents.filter((e) => e.eventType === 'ISSUE').length;
            const messages = recentRawEvents.filter((e) => e.eventType === 'MESSAGE').length;

            const tasksCompleted = recentTasks.filter((t) => t.status === 'DONE').length;
            const tasksInProgress = recentTasks.filter((t) => t.status === 'IN_PROGRESS').length;
            const tasksTotal = recentTasks.length;

            const featuresCompleted = recentFeatures.filter((f) => f.status === 'COMPLETED').length;
            const featuresInProgress = recentFeatures.filter((f) => f.status === 'IN_PROGRESS').length;
            const featuresTotal = recentFeatures.length;

            // 3. Build context for LLM
            const eventSummaries = recentLlmOutputs
                .filter((o) => o.type === 'SUMMARY')
                .map((o) => o.content)
                .slice(0, 20)
                .join('\n---\n');

            const systemPrompt = `You are generating a project status report.
Analyze the project activity and provide a comprehensive summary.

Return JSON in this exact format:
{
  "summary": string,  // 3-5 sentence summary of what's been done
  "highlights": {
    "completedFeatures": string[],
    "mergedPRs": number,
    "resolvedIssues": number,
    "keyAchievements": string[]
  },
  "codeQuality": {
    "issuesFound": number,
    "improvements": string[],
    "recommendations": string[]
  },
  "security": {
    "concerns": string[],
    "recommendations": string[],
    "riskLevel": "LOW" | "MEDIUM" | "HIGH"
  },
  "insights": string  // 2-3 sentences of key insights or trends
}

Rules:
- summary should be concise and actionable
- highlights should focus on major accomplishments
- insights should identify patterns or trends
- DO NOT wrap in markdown or code blocks`;

            const userPrompt = `PROJECT: ${project.name}
PERIOD: ${periodStart.toISOString()} to ${periodEnd.toISOString()}

ACTIVITY METRICS:
- Commits: ${commits}
- Pull Requests: ${pullRequests}
- Issues: ${issues}
- Messages: ${messages}
- Tasks Completed: ${tasksCompleted} / ${tasksTotal}
- Tasks In Progress: ${tasksInProgress}
- Features Completed: ${featuresCompleted} / ${featuresTotal}
- Features In Progress: ${featuresInProgress}

RECENT EVENT SUMMARIES:
${eventSummaries || 'No recent activity'}

Generate a comprehensive project status report.`;

            type ProjectReportData = {
                summary: string;
                highlights: {
                    completedFeatures: string[];
                    mergedPRs: number;
                    resolvedIssues: number;
                    keyAchievements: string[];
                };
                codeQuality: {
                    issuesFound: number;
                    improvements: string[];
                    recommendations: string[];
                };
                security: {
                    concerns: string[];
                    recommendations: string[];
                    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
                };
                insights: string;
            };

            const { result, llmUsageId } = await this.executeLlmOperation<ProjectReportData>({
                organizationId,
                operationType: 'PROJECT_REPORT',
                systemPrompt,
                userPrompt,
                maxTokens: 1200,
                temperature: 0.5,
                returnType: 'json',
            });

            // 4. Determine LlmOutputType based on reportType
            let outputType: LlmOutputType = 'DAILY_REPORT';
            if (reportType === 'WEEKLY') {
                outputType = 'WEEKLY_REPORT';
            } else if (reportType === 'MONTHLY') {
                outputType = 'DAILY_REPORT'; // Use DAILY_REPORT as fallback for monthly
            }

            // Create LlmOutput for the report
            const llmOutput = await this.databaseService.llmOutput.create({
                data: {
                    projectId,
                    type: outputType,
                    content: result.summary,
                    model: this.defaultModel,
                    metadata: {
                        reportType,
                        insights: result.insights,
                        periodStart: periodStart.toISOString(),
                        periodEnd: periodEnd.toISOString(),
                    },
                },
            });

            // 5. Create ProjectReport record
            const projectReport = await this.databaseService.projectReport.create({
            data: {
                projectId,
                    reportType,
                    periodStart,
                    periodEnd,
                    summary: result.summary,
                    highlights: {
                        ...result.highlights,
                        codeQuality: result.codeQuality || {
                            issuesFound: 0,
                            improvements: [],
                            recommendations: [],
                        },
                        security: result.security || {
                            concerns: [],
                            recommendations: [],
                            riskLevel: 'LOW',
                        },
                    },
                    metrics: {
                        commits,
                        pullRequests,
                        issues,
                        messages,
                        tasks: {
                            total: tasksTotal,
                            completed: tasksCompleted,
                            inProgress: tasksInProgress,
                        },
                        features: {
                            total: featuresTotal,
                            completed: featuresCompleted,
                            inProgress: featuresInProgress,
                        },
                        codeQualityReports: 0,
                        securityReports: 0,
                    },
                    featuresStatus: {
                        total: featuresTotal,
                        completed: featuresCompleted,
                        inProgress: featuresInProgress,
                        discovered: recentFeatures.filter((f) => f.status === 'DISCOVERED').length,
                    },
                    tasksStatus: {
                        total: tasksTotal,
                        completed: tasksCompleted,
                        inProgress: tasksInProgress,
                        todo: recentTasks.filter((t) => t.status === 'TODO').length,
                    },
                    llmOutputId: llmOutput.id,
                    generatedById: generatedById || undefined,
                },
            });

            // 6. Generate embedding for the report (for future retrieval)
            this.generateEmbeddingForContent(organizationId, llmOutput.id, result.summary).catch((err) =>
                this.logger.warn(`Failed to generate embedding for project report: ${err.message}`, LlmService.name)
            );

            this.logger.log(`Generated project report ${projectReport.id} for project ${projectId}`, LlmService.name);

            return {
                reportId: projectReport.id,
                summary: result.summary,
                highlights: result.highlights,
                metrics: projectReport.metrics as any,
            };
        } catch (error) {
            this.logger.error(`Project report generation failed for project ${projectId}: ${error.message}`, LlmService.name);
            throw error;
        }
    }

    // ==================== Code Analysis Methods ====================

    /**
     * Analyze code quality (migrated from llm.helper.ts)
     */
    async analyzeCodeQuality(
        organizationId: string,
        input: { files: { filename: string; patch?: string | null }[] },
        referenceId?: string
    ): Promise<{
        score: number;
        summary: string;
        issues: Array<{ type: string; severity: 'low' | 'medium' | 'high'; description: string }>;
        suggestions: string[];
    }> {
        const systemPrompt = `You are a senior code reviewer.

Return JSON ONLY in this exact format:

{
  "score": number,
  "summary": string,
  "issues": [
    {
      "type": string,
      "severity": "low" | "medium" | "high",
      "description": string
    }
  ],
  "suggestions": string[]
}

Rules:
- score must be 0–100
- issues may be empty
- suggestions may be empty
- DO NOT add markdown
- DO NOT wrap in \`\`\``;

        const userPrompt = `FILES CHANGED:
${input.files.map((f) => `File: ${f.filename}\n${f.patch ?? 'Diff omitted'}`).join('\n\n')}`;

        type CodeQualityAnalysis = {
            score: number;
            summary: string;
            issues: Array<{ type: string; severity: 'low' | 'medium' | 'high'; description: string }>;
            suggestions: string[];
        };

        const { result } = await this.executeLlmOperation<CodeQualityAnalysis>({
            organizationId,
            operationType: 'CODE_QUALITY',
            systemPrompt,
            userPrompt,
            maxTokens: 600,
            referenceId,
            referenceType: referenceId ? 'code_review' : undefined,
            returnType: 'json',
        });

        return result;
    }

    /**
     * Analyze security risks (migrated from llm.helper.ts)
     */
    async analyzeSecurityRisk(
        organizationId: string,
        input: { files: { filename: string; patch?: string | null }[] },
        referenceId?: string
    ): Promise<{
        risk: 'none' | 'low' | 'medium' | 'high';
        summary: string;
        findings: Array<{ type: string; severity: 'low' | 'medium' | 'high'; file: string; description: string }>;
        canAutoFix: boolean;
    }> {
        const systemPrompt = `You are a security-focused code reviewer.

Return JSON ONLY in this format:

{
  "risk": "none" | "low" | "medium" | "high",
  "summary": string,
  "findings": [
    {
      "type": string,
      "severity": "low" | "medium" | "high",
      "file": string,
      "description": string
    }
  ],
  "canAutoFix": boolean
}

Rules:
- If no issues, risk = "none" and findings = []
- DO NOT include markdown
- DO NOT wrap in \`\`\``;

        const userPrompt = `CODE CHANGES:
${input.files.map((f) => `File: ${f.filename}\n${f.patch ?? 'Diff omitted'}`).join('\n\n')}`;

        type SecurityAnalysis = {
            risk: 'none' | 'low' | 'medium' | 'high';
            summary: string;
            findings: Array<{ type: string; severity: 'low' | 'medium' | 'high'; file: string; description: string }>;
            canAutoFix: boolean;
        };

        const { result } = await this.executeLlmOperation<SecurityAnalysis>({
            organizationId,
            operationType: 'SECURITY_ANALYSIS',
            systemPrompt,
            userPrompt,
            maxTokens: 700,
            referenceId,
            referenceType: referenceId ? 'security_analysis' : undefined,
            returnType: 'json',
        });

        return result;
    }

    /**
     * Analyze issue and propose fix (migrated from llm.helper.ts)
     */
    async analyzeIssue(
        organizationId: string,
        input: { title: string; body?: string | null },
        referenceId?: string
    ): Promise<string> {
        const systemPrompt = `You are a debugging assistant.
Analyze the issue and propose a fix.`;

        const userPrompt = `ISSUE TITLE: ${input.title}

ISSUE DESCRIPTION: ${input.body ?? 'No description'}

Provide:
1. Root cause hypothesis
2. Suggested fix
3. Risk level`;

        const { result } = await this.executeLlmOperation<string>({
            organizationId,
            operationType: 'DEBUG_FIX',
            systemPrompt,
            userPrompt,
            maxTokens: 400,
            referenceId,
            referenceType: referenceId ? 'issue_analysis' : undefined,
            returnType: 'text',
        });

        return result;
    }

    /**
     * Generate debug fix with code suggestions (migrated from llm.helper.ts)
     */
    async generateDebugFix(
        organizationId: string,
        input: { issueTitle?: string; issueBody?: string | null; recentDiffs?: string | null },
        referenceId?: string
    ): Promise<string> {
        const systemPrompt = `You are a senior backend engineer.
Generate safe, production-ready fix suggestions.
DO NOT auto-commit.`;

        const userPrompt = `ISSUE:
${input.issueTitle ?? ''}
${input.issueBody ?? ''}

RECENT CODE CHANGES:
${input.recentDiffs ?? 'N/A'}

Return:
- Explanation
- Improved code snippet`;

        const { result } = await this.executeLlmOperation<string>({
            organizationId,
            operationType: 'DEBUG_FIX',
            systemPrompt,
            userPrompt,
            temperature: 0.25,
            maxTokens: 700,
            referenceId,
            referenceType: referenceId ? 'debug_fix' : undefined,
            returnType: 'text',
        });

        return result;
    }

    // ==================== Embedding Generation Methods ====================

    /**
     * Generate embedding for content using OpenAI embeddings API
     */
    private async generateEmbedding(content: string, model: string = this.embeddingModel): Promise<number[]> {
        try {
            const response = await this.openai.embeddings.create({
                model,
                input: content,
            });

            return response.data[0]?.embedding || [];
        } catch (error) {
            this.logger.error(`Failed to generate embedding: ${error.message}`, LlmService.name);
            throw new Error(`Embedding generation failed: ${error.message}`);
        }
    }

    /**
     * Chunk content for embedding (split long content into smaller chunks)
     */
    private chunkContentForEmbedding(content: string, maxChunkSize: number = 8000): string[] {
        // Simple chunking by character count (can be improved with sentence-aware chunking)
        const chunks: string[] = [];
        let currentChunk = '';

        const sentences = content.split(/[.!?]\s+/);
        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? '. ' : '') + sentence;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }

        return chunks.length > 0 ? chunks : [content];
    }

    /**
     * Store embedding in pgvector
     */
    private async storeEmbeddingInPgVector(params: {
        embeddingId: string;
        embedding: number[];
        vectorRef: string;
        llmOutputId?: string;
        contentChunkId?: string;
        model?: string;
    }): Promise<void> {
        const { embeddingId, embedding, vectorRef, llmOutputId, contentChunkId, model = this.embeddingModel } = params;

        // Validate: exactly one of llmOutputId or contentChunkId must be provided
        if ((llmOutputId && contentChunkId) || (!llmOutputId && !contentChunkId)) {
            throw new BadRequestException('Embedding must have exactly one of llmOutputId or contentChunkId');
        }

        const dimension = embedding.length;

        // Create the Embedding record in Prisma
        await this.databaseService.embedding.upsert({
            where: { id: embeddingId },
            update: {
                vectorRef,
                dimension,
                model,
            },
            create: {
                id: embeddingId,
                llmOutputId: llmOutputId || undefined,
                contentChunkId: contentChunkId || undefined,
                vectorRef,
                dimension,
                model,
            },
        });

        // Store vector in pgvector using Prisma's raw SQL
        // Note: The Embedding table needs a vector column (added by migration: 20260111014551_add_pgvector_support)
        // Prisma doesn't natively support vector type in schema, but we can use raw SQL with proper parameter binding
        try {
            // Convert embedding array to PostgreSQL vector format string: [v1, v2, v3, ...]
            const vectorStr = `[${embedding.join(',')}]`;
            
            // Use $executeRawUnsafe with parameterized query
            // PostgreSQL requires the vector string to be cast to vector type
            // Parameter binding: $1 = vector string, $2 = embeddingId
            await this.databaseService.$executeRawUnsafe(
                `UPDATE "Embedding" SET vector = $1::vector WHERE id = $2`,
                vectorStr,
                embeddingId
            );
        } catch (error) {
            // If vector column doesn't exist or migration not run, log warning and continue
            // The embedding record is still created with vectorRef for external lookup
            // Vector similarity search will fall back to keyword search
            this.logger.warn(
                `Could not store vector in pgvector: ${error.message}. ` +
                `Please ensure migration 20260111014551_add_pgvector_support has been applied. ` +
                `Using vectorRef only.`,
                LlmService.name
            );
        }
    }

    /**
     * Generate embedding for RawEvent (implemented properly now)
     */
    private async generateEmbeddingForRawEvent(rawEventId: string, organizationId: string, content: string): Promise<void> {
        if (!content || content.trim().length === 0) {
            return;
        }

        try {
            // Get RawEvent to ensure it exists
            const rawEvent = await this.databaseService.rawEvent.findUnique({
                where: { id: rawEventId },
                select: { id: true, projectId: true },
            });

            if (!rawEvent) {
                throw new BadRequestException(`RawEvent ${rawEventId} not found`);
            }

            // Create LlmUsage record for embedding generation
            const llmUsage = await this.databaseService.llmUsage.create({
                data: {
                    organizationId,
                    operationType: 'EMBEDDING',
                    creditsConsumed: new Decimal(0),
                    status: 'PENDING',
                    model: this.embeddingModel,
                    referenceId: rawEventId,
                    referenceType: 'raw_event',
                },
            });

            // Chunk content if too long
            const chunks = this.chunkContentForEmbedding(content);

            // Get or create LlmOutput for this rawEvent
            const llmOutput = await this.databaseService.llmOutput.findFirst({
                where: { rawEventId },
                orderBy: { createdAt: 'desc' },
            });

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const embedding = await this.generateEmbedding(chunk, this.embeddingModel);

                // Calculate credits for embedding (only input tokens)
                const estimatedTokens = Math.ceil(chunk.length / 4);
                const credits = this.calculateCredits(this.embeddingModel, estimatedTokens, 0);

                // Create content chunk (ContentChunk requires rawEventId)
                let contentChunkId: string | undefined;
                if (chunks.length > 1 || !llmOutput) {
                    // Always create ContentChunk when we have chunks or no LlmOutput yet
                    const chunkRecord = await this.databaseService.contentChunk.create({
                        data: {
                            rawEventId,
                            llmOutputId: llmOutput?.id || undefined,
                            content: chunk,
                            chunkIndex: i,
                            startOffset: i > 0 ? chunks.slice(0, i).join('').length : 0,
                            endOffset: chunks.slice(0, i + 1).join('').length,
                            metadata: { totalChunks: chunks.length },
                        },
                    });
                    contentChunkId = chunkRecord.id;
                }

                // Store embedding - use vectorRef as unique identifier
                const vectorRef = `raw_event_${rawEventId}_chunk_${i}`;
                const embeddingId = `${rawEventId}-embedding-${i}`;

                await this.storeEmbeddingInPgVector({
                    embeddingId,
                    embedding,
                    vectorRef,
                    llmOutputId: chunks.length === 1 && llmOutput ? llmOutput.id : undefined,
                    contentChunkId: contentChunkId || undefined,
                    model: this.embeddingModel,
                });

                // Update credits consumed
                await this.databaseService.llmUsage.update({
                    where: { id: llmUsage.id },
                    data: {
                        creditsConsumed: { increment: credits },
                        inputTokens: { increment: estimatedTokens },
                        totalTokens: { increment: estimatedTokens },
                        status: 'COMPLETED',
                    },
                });
            }

            // Deduct credits atomically
            const updatedUsage = await this.databaseService.llmUsage.findUnique({
                where: { id: llmUsage.id },
                select: { creditsConsumed: true },
            });

            if (updatedUsage && updatedUsage.creditsConsumed.gt(0)) {
                await this.deductCreditsAtomically(organizationId, updatedUsage.creditsConsumed, llmUsage.id);
            }

            this.logger.log(`Generated embeddings for RawEvent ${rawEventId} (${chunks.length} chunks)`, LlmService.name);
        } catch (error) {
            this.logger.error(`Failed to generate embedding for RawEvent ${rawEventId}: ${error.message}`, LlmService.name);
            // Don't throw - embedding failure shouldn't block RawEvent processing
        }
    }

    /**
     * Generate embedding for general content (public method)
     * Requires llmOutputId since we need to link to an LlmOutput
     */
    async generateEmbeddingForContent(
        organizationId: string,
        llmOutputId: string,
        content: string
    ): Promise<string> {
        if (!content || content.trim().length === 0) {
            throw new BadRequestException('Content cannot be empty');
        }

        // Verify LlmOutput exists and get organizationId from project
        const llmOutput = await this.databaseService.llmOutput.findUnique({
            where: { id: llmOutputId },
            include: { project: { select: { organizationId: true } } },
        });

        if (!llmOutput || !llmOutput.project) {
            throw new BadRequestException(`LlmOutput ${llmOutputId} not found or has no project`);
        }

        // Use the organizationId from the parameter if provided, otherwise from project
        const actualOrganizationId = organizationId || llmOutput.project.organizationId;
        if (actualOrganizationId !== llmOutput.project.organizationId) {
            throw new BadRequestException(`Organization mismatch for LlmOutput ${llmOutputId}`);
        }

        // Check credits
        const estimatedTokens = Math.ceil(content.length / 4);
        const estimatedCredits = this.calculateCredits(this.embeddingModel, estimatedTokens, 0);
        const hasCredits = await this.checkCreditBalance(actualOrganizationId, estimatedCredits);
        if (!hasCredits) {
            throw new BadRequestException('Insufficient credits for embedding generation');
        }

        // Create LlmUsage record
        const llmUsage = await this.databaseService.llmUsage.create({
            data: {
                organizationId: actualOrganizationId,
                operationType: 'EMBEDDING',
                creditsConsumed: new Decimal(0),
                status: 'PENDING',
                model: this.embeddingModel,
                referenceId: llmOutputId,
                referenceType: 'llm_output',
            },
        });

        try {
            // Chunk and generate embeddings
            const chunks = this.chunkContentForEmbedding(content);
            let firstEmbeddingId: string | undefined;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const embedding = await this.generateEmbedding(chunk, this.embeddingModel);

                const tokens = Math.ceil(chunk.length / 4);
                const credits = this.calculateCredits(this.embeddingModel, tokens, 0);

                const embeddingId = `${llmOutputId}-embedding-${i}`;
                const vectorRef = `llm_output_${llmOutputId}_chunk_${i}`;

                if (i === 0) firstEmbeddingId = embeddingId;

                await this.storeEmbeddingInPgVector({
                    embeddingId,
                    embedding,
                    vectorRef,
                    llmOutputId,
                    model: this.embeddingModel,
                });

                // Update credits
                await this.databaseService.llmUsage.update({
                    where: { id: llmUsage.id },
                    data: {
                        creditsConsumed: { increment: credits },
                        inputTokens: { increment: tokens },
                        totalTokens: { increment: tokens },
                        status: 'COMPLETED',
                    },
                });
            }

            // Deduct credits
            const totalCredits = await this.databaseService.llmUsage.findUnique({
                where: { id: llmUsage.id },
                select: { creditsConsumed: true },
            });

            if (totalCredits && totalCredits.creditsConsumed.gt(0)) {
                await this.deductCreditsAtomically(actualOrganizationId, totalCredits.creditsConsumed, llmUsage.id);
            }

            return firstEmbeddingId || llmUsage.id;
        } catch (error) {
            await this.databaseService.llmUsage.update({
                where: { id: llmUsage.id },
                data: {
                    status: 'FAILED',
                    errorMessage: error.message || 'Unknown error',
                },
            });
            throw error;
        }
    }

    // ==================== RAG Chatbot Methods ====================

    /**
     * Search similar content using pgvector cosine similarity
     * Uses Prisma's $queryRawUnsafe for pgvector operations (vector type not natively supported)
     */
    private async searchSimilarContent(
        queryEmbedding: number[],
        projectId: string,
        limit: number = 5,
        threshold: number = 0.7
    ): Promise<Array<{ embeddingId: string; llmOutputId?: string; contentChunkId?: string; similarity: number; content: string }>> {
        try {
            // Convert embedding array to PostgreSQL vector format string
            const vectorStr = `[${queryEmbedding.join(',')}]`;

            // Query pgvector for similar embeddings using cosine similarity (<=> operator)
            // Note: This assumes the Embedding table has a vector column added via migration
            // Use $queryRawUnsafe because Prisma.sql doesn't support dynamic vector type casting
            // Prisma's connection pool handles the query efficiently
            const result = await this.databaseService.$queryRawUnsafe<Array<{
                embeddingId: string;
                llmOutputId: string | null;
                contentChunkId: string | null;
                similarity: number;
                content: string | null;
            }>>(
                `
                SELECT 
                    e.id as "embeddingId",
                    e."llmOutputId",
                    e."contentChunkId",
                    1 - (e.vector <=> $1::vector) as similarity,
                    CASE
                        WHEN e."llmOutputId" IS NOT NULL THEN lo.content
                        WHEN e."contentChunkId" IS NOT NULL THEN cc.content
                        ELSE ''
                    END as content
                FROM "Embedding" e
                LEFT JOIN "LlmOutput" lo ON e."llmOutputId" = lo.id
                LEFT JOIN "ContentChunk" cc ON e."contentChunkId" = cc.id
                WHERE lo."projectId" = $2
                   OR (cc."rawEventId" IS NOT NULL AND EXISTS (
                       SELECT 1 FROM "RawEvent" re 
                       WHERE re.id = cc."rawEventId" AND re."projectId" = $2
                   ))
                ORDER BY e.vector <=> $1::vector
                LIMIT $3
                `,
                vectorStr,
                projectId,
                limit
            );

            return result
                .filter((row) => row.similarity >= threshold)
                .map((row) => ({
                    embeddingId: row.embeddingId,
                    llmOutputId: row.llmOutputId || undefined,
                    contentChunkId: row.contentChunkId || undefined,
                    similarity: typeof row.similarity === 'string' ? parseFloat(row.similarity) : row.similarity,
                    content: row.content || '',
                }));
        } catch (error) {
            // Fallback to keyword search if pgvector query fails
            this.logger.warn(`Vector search failed: ${error.message}. Falling back to keyword search.`, LlmService.name);
            
            // Fallback: Get recent LlmOutputs
            const llmOutputs = await this.databaseService.llmOutput.findMany({
                where: { projectId },
                orderBy: { createdAt: 'desc' },
                take: limit,
                select: { id: true, content: true },
            });

            return llmOutputs.map((output, index) => ({
                embeddingId: `${output.id}-fallback`,
                llmOutputId: output.id,
                similarity: 0.8 - index * 0.1, // Decreasing similarity
                content: output.content,
            }));
        }
    }

    /**
     * Chat method - RAG-based chatbot with vector similarity search
     * Supports project-scoped, org-scoped, task team, and direct conversations
     */
    async chat(params: {
        conversationId: string;
        question: string;
        userId: string;
        projectId?: string;
        organizationId?: string;
    }): Promise<{
        answer: string;
        chatMessageId: string;
        sources: Array<{ llmOutputId?: string; rawEventId?: string; relevanceScore: number }>;
    }> {
        const { conversationId, question, userId, projectId, organizationId } = params;

        // Get conversation to determine scope
        const conversation = await this.databaseService.conversation.findUnique({
            where: { id: conversationId },
            include: {
                project: { include: { organization: true } },
                organization: true,
                task: { include: { project: { include: { organization: true } } } },
            },
        });

        if (!conversation) {
            throw new BadRequestException(`Conversation ${conversationId} not found`);
        }

        // Determine organization and project context
        let actualOrganizationId: string;
        let actualProjectId: string | undefined;

        if (conversation.project) {
            actualProjectId = conversation.project.id;
            actualOrganizationId = conversation.project.organizationId;
        } else if (conversation.organization) {
            actualOrganizationId = conversation.organizationId!;
        } else if (conversation.task && conversation.task.project) {
            actualProjectId = conversation.task.project.id;
            actualOrganizationId = conversation.task.project.organizationId;
        } else {
            throw new BadRequestException('Conversation must be associated with a project or organization');
        }

        // Validate organizationId parameter matches
        if (organizationId && organizationId !== actualOrganizationId) {
            throw new BadRequestException('Organization mismatch');
        }

        // Validate projectId parameter matches
        if (projectId && actualProjectId && projectId !== actualProjectId) {
            throw new BadRequestException('Project mismatch');
        }

        // If no project but we need one for RAG, we can't proceed
        if (!actualProjectId) {
            throw new BadRequestException('RAG chat requires a project context');
        }

        // Create user message
        const userMessage = await this.databaseService.chatMessage.create({
            data: {
                conversationId,
                role: 'USER',
                content: question,
                senderId: userId,
            },
        });

        try {
            // 1. Generate embedding for the question
            const questionEmbedding = await this.generateEmbedding(question, this.embeddingModel);

            // 2. Search for similar content using vector similarity
            const similarContent = await this.searchSimilarContent(questionEmbedding, actualProjectId, 5, 0.7);

            // 3. Build context from similar content
            const context = similarContent
                .map((item, index) => `[Source ${index + 1}] ${item.content}`)
                .join('\n\n---\n\n')
                .slice(0, 4000); // Limit context size

            // 4. Get recent conversation history (last 10 messages for context)
            const recentMessages = await this.databaseService.chatMessage.findMany({
                where: { conversationId },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: { role: true, content: true },
            });

            const conversationHistory = recentMessages
                .reverse()
                .map((msg) => `${msg.role}: ${msg.content}`)
                .join('\n')
                .slice(0, 2000);

            // 5. Generate answer using LLM with RAG context
            const systemPrompt = `You are a helpful AI assistant answering questions about a software project.
Use the provided context to answer accurately. Cite sources when relevant.
If the context doesn't contain enough information, say so clearly.
Keep answers concise and actionable.`;

            const userPrompt = `CONVERSATION HISTORY:
${conversationHistory}

RELEVANT PROJECT CONTEXT:
${context}

USER QUESTION: ${question}

Provide a clear, concise answer based on the context. Reference sources when relevant.`;

            const { result: answer } = await this.executeLlmOperation<string>({
                organizationId: actualOrganizationId,
                operationType: 'CHAT_ANSWER',
                systemPrompt,
                userPrompt,
                maxTokens: 800,
                temperature: 0.7,
                referenceId: conversationId,
                referenceType: 'conversation',
                returnType: 'text',
            });

            // 6. Create assistant message
            const assistantMessage = await this.databaseService.chatMessage.create({
                data: {
                    conversationId,
                    role: 'ASSISTANT',
                content: answer,
                    metadata: {
                        model: this.defaultModel,
                        sourcesCount: similarContent.length,
                    },
            },
        });

            // 7. Create source references (ChatMessageSource)
            const sourcePromises: Promise<any>[] = [];
            
            for (const item of similarContent) {
                let rawEventId: string | undefined;
                
                // Get rawEventId from ContentChunk if available
                if (item.contentChunkId) {
                    const contentChunk = await this.databaseService.contentChunk.findUnique({
                        where: { id: item.contentChunkId },
                        select: { rawEventId: true },
                    });
                    rawEventId = contentChunk?.rawEventId || undefined;
                }

                // Create source reference (prefer llmOutputId, fallback to rawEventId)
                if (item.llmOutputId || rawEventId) {
                    sourcePromises.push(
                        this.databaseService.chatMessageSource.create({
                            data: {
                                chatMessageId: assistantMessage.id,
                                llmOutputId: item.llmOutputId || undefined,
                                rawEventId: rawEventId || undefined,
                                relevanceScore: item.similarity,
                            },
                        })
                    );
                }
            }

            await Promise.all(sourcePromises);

            // 8. Update conversation timestamp
            await this.databaseService.conversation.update({
                where: { id: conversationId },
                data: { updatedAt: new Date() },
            });

            // 9. Generate embedding for the question and answer (for future retrieval)
            // This is done asynchronously to not block the response
            this.generateEmbeddingForRawEvent(`chat_${conversationId}_${userMessage.id}`, actualOrganizationId, question).catch(
                (err) => this.logger.warn(`Failed to generate embedding for chat question: ${err.message}`, LlmService.name)
            );

            this.logger.log(`Chat response generated for conversation ${conversationId}`, LlmService.name);

            return {
                answer,
                chatMessageId: assistantMessage.id,
                sources: similarContent.map((item) => ({
                    llmOutputId: item.llmOutputId,
                    relevanceScore: item.similarity,
                })),
            };
        } catch (error) {
            this.logger.error(`Chat failed for conversation ${conversationId}: ${error.message}`, LlmService.name);
            throw error;
        }
    }
}