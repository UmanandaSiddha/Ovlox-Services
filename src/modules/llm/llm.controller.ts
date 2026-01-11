import { Controller, Post, Get, Put, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { LlmService } from './llm.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { DatabaseService } from 'src/services/database/database.service';
import { ConversationType } from 'generated/prisma/enums';

@UseGuards(AuthGuard)
@Controller('chat')
export class LlmController {
    constructor(
        private readonly llmService: LlmService,
        private readonly databaseService: DatabaseService,
    ) { }

    @Post('conversations')
    async createConversation(
        @getUser('id') userId: string,
        @Body() body: { projectId?: string; organizationId?: string; title?: string; type?: ConversationType }
    ) {
        const { projectId, organizationId, title, type = 'RAG_CHAT' } = body;

        if (!projectId && !organizationId) {
            throw new BadRequestException('Either projectId or organizationId is required');
        }

        if (type === 'RAG_CHAT' && !projectId) {
            throw new BadRequestException('RAG_CHAT requires a projectId');
        }

        const conversation = await this.databaseService.conversation.create({
            data: {
                type,
                projectId: projectId || undefined,
                organizationId: organizationId || undefined,
                title: title || 'New Conversation',
                createdBy: userId,
            },
        });

        // Add user as participant
        await this.databaseService.conversationParticipant.create({
            data: {
                conversationId: conversation.id,
                userId,
            },
        });

        return conversation;
    }

    @Get('conversations')
    async listConversations(
        @getUser('id') userId: string,
        @Query('projectId') projectId?: string,
        @Query('organizationId') organizationId?: string
    ) {
        const conversations = await this.databaseService.conversationParticipant.findMany({
            where: {
                userId,
                leftAt: null,
                ...(projectId ? { conversation: { projectId } } : {}),
                ...(organizationId ? { conversation: { organizationId } } : {}),
            },
            include: {
                conversation: {
                    include: {
                        messages: {
                            take: 1,
                            orderBy: { createdAt: 'desc' },
                        },
                    },
                },
            },
            orderBy: {
                conversation: {
                    updatedAt: 'desc',
                },
            },
            take: 50,
        });

        return conversations.map((cp) => cp.conversation);
    }

    @Get('conversations/:id')
    async getConversation(@Param('id') id: string, @getUser('id') userId: string) {
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId: id,
                    userId,
                },
            },
            include: {
                conversation: {
                    include: {
                        messages: {
                            orderBy: { createdAt: 'asc' },
                            take: 100,
                        },
                        project: {
                            include: { organization: true },
                        },
                        organization: true,
                    },
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new BadRequestException('Conversation not found or access denied');
        }

        return participant.conversation;
    }

    @Put('conversations/:id')
    async updateConversation(
        @Param('id') id: string,
        @getUser('id') userId: string,
        @Body() body: { title?: string }
    ) {
        // Verify user is participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId: id,
                    userId,
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new BadRequestException('Conversation not found or access denied');
        }

        return this.databaseService.conversation.update({
            where: { id },
            data: { title: body.title },
        });
    }

    @Get('conversations/:id/messages')
    async getMessages(
        @Param('id') conversationId: string,
        @getUser('id') userId: string,
        @Query('limit') limit: number = 50,
        @Query('before') before?: string
    ) {
        // Verify user is participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId,
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new BadRequestException('Conversation not found or access denied');
        }

        const messages = await this.databaseService.chatMessage.findMany({
            where: {
                conversationId,
                ...(before ? { id: { lt: before } } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(limit, 100),
            include: {
                sender: true,
                senderMember: true,
                sources: {
                    include: {
                        rawEvent: true,
                        llmOutput: true,
                    },
                },
            },
        });

        return messages.reverse(); // Return in chronological order
    }

    @Post('conversations/:id/messages')
    async sendMessage(
        @Param('id') conversationId: string,
        @getUser('id') userId: string,
        @Body() body: { question: string }
    ) {
        const { question } = body;

        if (!question || question.trim().length === 0) {
            throw new BadRequestException('Question is required');
        }

        // Get conversation with project/org context
        const conversation = await this.databaseService.conversation.findUnique({
            where: { id: conversationId },
            include: {
                project: {
                    include: { organization: true },
                },
                organization: true,
            },
        });

        if (!conversation) {
            throw new BadRequestException('Conversation not found');
        }

        // Verify user is participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId,
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new BadRequestException('Access denied');
        }

        // Get user's organization member if project/org exists
        let memberId: string | undefined;
        if (conversation.project) {
            const member = await this.databaseService.organizationMember.findFirst({
                where: {
                    userId,
                    organizationId: conversation.project.organizationId,
                },
            });
            memberId = member?.id;
        } else if (conversation.organizationId) {
            const member = await this.databaseService.organizationMember.findFirst({
                where: {
                    userId,
                    organizationId: conversation.organizationId,
                },
            });
            memberId = member?.id;
        }

        // Use LlmService.chat method
        const result = await this.llmService.chat({
            conversationId,
            question,
            userId,
            projectId: conversation.projectId || undefined,
            organizationId: conversation.project?.organizationId || conversation.organizationId || undefined,
        });

        return result;
    }
}
