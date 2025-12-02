import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';

/**
 * This service contains stubs for:
 * - per-event LLM processing (summarize commits/messages)
 * - embedding generation (call your embedding model)
 * - project chat (semantic search & answer)
 *
 * Replace placeholder OpenAI calls with your provider (OpenAI, LangChain orchestrator etc).
 */

@Injectable()
export class LlmService {
    private readonly logger = new LoggerService(LlmService.name);
    private openaiKey: string;

    constructor(
        private readonly databaseService: DatabaseService,
        private cfg: ConfigService
    ) {
        this.openaiKey = cfg.get<string>('openaiApiKey') || '';
    }

    // called by ingestion worker after RawEvent created
    async processRawEvent(rawEventId: string) {
        // 1. load raw event
        const ev = await this.databaseService.rawEvent.findUnique({ where: { id: rawEventId } });
        if (!ev) throw new Error('raw event not found');

        // 2. build a prompt based on ev.eventType
        const prompt = `Summarize event (${ev.eventType}) content: ${ev.content?.slice(0, 2000)}`;

        // 3. call your LLM here - placeholder:
        const summary = `AI summary for ${ev.source} ${ev.sourceId || ''}: ${ev.content?.slice(0, 200)}`;

        const llm = await this.databaseService.llmOutput.create({
            data: {
                projectId: ev.projectId,
                rawEventId: ev.id,
                type: 'summary',
                content: summary,
                model: 'local-stub',
            },
        });

        // TODO: create embedding via external vector db and create Embedding row with vectorRef
        await this.databaseService.rawEvent.update({ where: { id: ev.id }, data: { processedByLLM: true } });
        return llm;
    }

    // project chat (very simple retrieval + stub)
    async chat(projectId: string, question: string) {
        // TODO: run a semantic search on embeddings -> fetch top-k LlmOutputs -> build prompt
        const recent = await this.databaseService.llmOutput.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
            take: 6,
        });

        const context = recent.map((r) => r.content).join('\n---\n').slice(0, 3000);
        const prompt = `Context:\n${context}\nUser question: ${question}\nAnswer concisely.`;

        // placeholder answer:
        const answer = `Answer (stub): based on ${recent.length} snippets.`;

        const out = await this.databaseService.llmOutput.create({
            data: {
                projectId,
                type: 'answer',
                content: answer,
                model: 'local-stub',
            },
        });

        return { answer, out };
    }
}