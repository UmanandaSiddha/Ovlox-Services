import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SocketGuard } from '../auth/guards/socket.guard';
import { DatabaseService } from 'src/services/database/database.service';
import { ConversationType, ChatRole } from 'generated/prisma/enums';
import { allowedOrigins } from 'src/config/origin';
import { AuthorizationService } from '../auth/authorization.service';
import { PermissionName } from 'generated/prisma/enums';

@WebSocketGateway({
    namespace: '/chat',
    cors: {
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void): void => {
            if (!origin || allowedOrigins.includes(origin as string)) {
                callback(null, origin);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
    },
    transports: ['websocket'],
})
@UseGuards(SocketGuard)
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() public server: Server;

    // Track typing users per conversation
    private typingUsers: Map<string, Map<string, NodeJS.Timeout>> = new Map();

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly authorizationService: AuthorizationService,
    ) { }

    async handleConnection(client: Socket) {
        const user = client.data.user;
        if (!user) {
            client.disconnect();
            return;
        }

        console.log(`[ChatGateway] User ${user.id} connected to chat namespace`);
        
        // Join user's personal room for direct messages
        client.join(`user:${user.id}`);

        // Auto-join user to their active conversations
        await this.joinUserConversations(client, user.id);
    }

    async handleDisconnect(client: Socket) {
        const user = client.data.user;
        if (!user) return;

        console.log(`[ChatGateway] User ${user.id} disconnected from chat namespace`);

        // Clean up typing indicators
        this.typingUsers.forEach((conversationTyping, conversationId) => {
            if (conversationTyping.has(user.id)) {
                clearTimeout(conversationTyping.get(user.id)!);
                conversationTyping.delete(user.id);
            }
        });
    }

    /**
     * Auto-join user to their active conversations
     */
    private async joinUserConversations(client: Socket, userId: string) {
        const participants = await this.databaseService.conversationParticipant.findMany({
            where: {
                userId,
                leftAt: null, // Only active conversations
            },
            include: {
                conversation: true,
            },
        });

        for (const participant of participants) {
            const conversation = participant.conversation;
            const roomName = this.getRoomName(conversation);
            client.join(roomName);
            console.log(`[ChatGateway] User ${userId} auto-joined conversation ${conversation.id} (room: ${roomName})`);
        }
    }

    /**
     * Get room name for a conversation
     */
    private getRoomName(conversation: { id: string; type: ConversationType; organizationId?: string | null; projectId?: string | null }): string {
        switch (conversation.type) {
            case ConversationType.ORG:
                return `org:${conversation.organizationId}`;
            case ConversationType.PROJECT:
                return `project:${conversation.projectId}`;
            case ConversationType.DIRECT:
                return `conversation:${conversation.id}`;
            case ConversationType.TASK_TEAM:
                return `task-team:${conversation.id}`;
            case ConversationType.RAG_CHAT:
                return `rag-chat:${conversation.id}`;
            default:
                return `conversation:${conversation.id}`;
        }
    }

    /**
     * Join a conversation room
     */
    @SubscribeMessage('joinConversation')
    async handleJoinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string }
    ) {
        const user = client.data.user;
        if (!user) {
            throw new BadRequestException('User not authenticated');
        }

        const { conversationId } = data;
        if (!conversationId) {
            throw new BadRequestException('conversationId is required');
        }

        // Verify user is a participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: user.id,
                },
            },
            include: {
                conversation: {
                    include: {
                        organization: true,
                        project: {
                            include: {
                                organization: true,
                            },
                        },
                    },
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new ForbiddenException('Not a participant in this conversation');
        }

        const conversation = participant.conversation;
        const roomName = this.getRoomName(conversation);

        // Join the room
        client.join(roomName);

        // Emit confirmation
        client.emit('conversationJoined', {
            conversationId,
            roomName,
        });

        console.log(`[ChatGateway] User ${user.id} joined conversation ${conversationId} (room: ${roomName})`);
    }

    /**
     * Leave a conversation room
     */
    @SubscribeMessage('leaveConversation')
    async handleLeaveConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string }
    ) {
        const user = client.data.user;
        if (!user) return;

        const { conversationId } = data;
        if (!conversationId) return;

        const conversation = await this.databaseService.conversation.findUnique({
            where: { id: conversationId },
        });

        if (!conversation) return;

        const roomName = this.getRoomName(conversation);
        client.leave(roomName);

        // Clean up typing indicator
        if (this.typingUsers.has(conversationId)) {
            const conversationTyping = this.typingUsers.get(conversationId)!;
            if (conversationTyping.has(user.id)) {
                clearTimeout(conversationTyping.get(user.id)!);
                conversationTyping.delete(user.id);
            }
        }

        client.emit('conversationLeft', { conversationId });
        console.log(`[ChatGateway] User ${user.id} left conversation ${conversationId}`);
    }

    /**
     * Send a chat message
     */
    @SubscribeMessage('sendMessage')
    async handleSendMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string; content: string }
    ) {
        const user = client.data.user;
        if (!user) {
            throw new BadRequestException('User not authenticated');
        }

        const { conversationId, content } = data;

        if (!conversationId || !content || content.trim().length === 0) {
            throw new BadRequestException('conversationId and content are required');
        }

        // Get conversation with context
        const conversation = await this.databaseService.conversation.findUnique({
            where: { id: conversationId },
            include: {
                organization: true,
                project: {
                    include: {
                        organization: true,
                    },
                },
            },
        });

        if (!conversation) {
            throw new BadRequestException('Conversation not found');
        }

        // Verify user is a participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: user.id,
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new ForbiddenException('Not a participant in this conversation');
        }

        // Get organization member if conversation is org/project scoped
        let memberId: string | undefined;
        if (conversation.organizationId) {
            const member = await this.databaseService.organizationMember.findFirst({
                where: {
                    userId: user.id,
                    organizationId: conversation.organizationId,
                    status: 'ACTIVE',
                },
            });
            memberId = member?.id;
        } else if (conversation.project?.organizationId) {
            const member = await this.databaseService.organizationMember.findFirst({
                where: {
                    userId: user.id,
                    organizationId: conversation.project.organizationId,
                    status: 'ACTIVE',
                },
            });
            memberId = member?.id;
        }

        // Create message in database
        const message = await this.databaseService.chatMessage.create({
            data: {
                conversationId,
                role: ChatRole.USER,
                content: content.trim(),
                senderId: user.id,
                senderMemberId: memberId || undefined,
            },
            include: {
                sender: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                senderMember: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                avatarUrl: true,
                            },
                        },
                    },
                },
                mentions: {
                    include: {
                        mentionedUser: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                            },
                        },
                        mentionedMember: {
                            include: {
                                user: {
                                    select: {
                                        id: true,
                                        firstName: true,
                                        lastName: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        // Update conversation updatedAt
        await this.databaseService.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
        });

        // Get room name and broadcast to all participants
        const roomName = this.getRoomName(conversation);
        
        // Emit to all participants in the room
        this.server.to(roomName).emit('newMessage', {
            message,
            conversationId,
        });

        // Also emit to user's personal room for notifications
        this.server.to(`user:${user.id}`).emit('messageSent', {
            messageId: message.id,
            conversationId,
        });

        // If this is a RAG_CHAT, trigger RAG processing (async, don't block)
        if (conversation.type === ConversationType.RAG_CHAT && conversation.projectId) {
            // Note: RAG processing should be handled by the REST endpoint or a separate queue
            // This is just for real-time message delivery
        }

        console.log(`[ChatGateway] User ${user.id} sent message in conversation ${conversationId}`);

        return {
            success: true,
            message,
        };
    }

    /**
     * Typing indicator
     */
    @SubscribeMessage('typing')
    async handleTyping(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string; isTyping: boolean }
    ) {
        const user = client.data.user;
        if (!user) return;

        const { conversationId, isTyping } = data;
        if (!conversationId) return;

        // Verify user is a participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: user.id,
                },
            },
        });

        if (!participant || participant.leftAt) return;

        const conversation = await this.databaseService.conversation.findUnique({
            where: { id: conversationId },
        });

        if (!conversation) return;

        const roomName = this.getRoomName(conversation);

        if (isTyping) {
            // Clear existing timeout
            if (this.typingUsers.has(conversationId)) {
                const conversationTyping = this.typingUsers.get(conversationId)!;
                if (conversationTyping.has(user.id)) {
                    clearTimeout(conversationTyping.get(user.id)!);
                }
            } else {
                this.typingUsers.set(conversationId, new Map());
            }

            // Emit typing indicator
            client.to(roomName).emit('userTyping', {
                conversationId,
                userId: user.id,
                userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || user.phoneNumber,
                isTyping: true,
            });

            // Set timeout to auto-stop typing after 3 seconds
            const timeout = setTimeout(() => {
                client.to(roomName).emit('userTyping', {
                    conversationId,
                    userId: user.id,
                    isTyping: false,
                });
                if (this.typingUsers.has(conversationId)) {
                    this.typingUsers.get(conversationId)!.delete(user.id);
                }
            }, 3000);

            this.typingUsers.get(conversationId)!.set(user.id, timeout);
        } else {
            // Stop typing
            if (this.typingUsers.has(conversationId)) {
                const conversationTyping = this.typingUsers.get(conversationId)!;
                if (conversationTyping.has(user.id)) {
                    clearTimeout(conversationTyping.get(user.id)!);
                    conversationTyping.delete(user.id);
                }
            }

            client.to(roomName).emit('userTyping', {
                conversationId,
                userId: user.id,
                isTyping: false,
            });
        }
    }

    /**
     * Mark messages as read
     */
    @SubscribeMessage('markAsRead')
    async handleMarkAsRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string; lastReadAt?: string }
    ) {
        const user = client.data.user;
        if (!user) return;

        const { conversationId, lastReadAt } = data;
        if (!conversationId) return;

        // Verify user is a participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: user.id,
                },
            },
        });

        if (!participant || participant.leftAt) return;

        // Update lastReadAt
        await this.databaseService.conversationParticipant.update({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: user.id,
                },
            },
            data: {
                lastReadAt: lastReadAt ? new Date(lastReadAt) : new Date(),
            },
        });

        // Emit read receipt to other participants
        const conversation = await this.databaseService.conversation.findUnique({
            where: { id: conversationId },
        });

        if (conversation) {
            const roomName = this.getRoomName(conversation);
            client.to(roomName).emit('messageRead', {
                conversationId,
                userId: user.id,
                lastReadAt: lastReadAt || new Date().toISOString(),
            });
        }
    }

    /**
     * Join organization chat room (for ORG type conversations)
     */
    @SubscribeMessage('joinOrgChat')
    async handleJoinOrgChat(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { organizationId: string }
    ) {
        const user = client.data.user;
        if (!user) {
            throw new BadRequestException('User not authenticated');
        }

        const { organizationId } = data;
        if (!organizationId) {
            throw new BadRequestException('organizationId is required');
        }

        // Verify user is a member of the organization
        const member = await this.databaseService.organizationMember.findFirst({
            where: {
                userId: user.id,
                organizationId,
                status: 'ACTIVE',
            },
        });

        if (!member) {
            throw new ForbiddenException('Not a member of this organization');
        }

        // Join organization room
        const roomName = `org:${organizationId}`;
        client.join(roomName);

        // Also join all active org conversations
        const conversations = await this.databaseService.conversation.findMany({
            where: {
                organizationId,
                type: ConversationType.ORG,
            },
            include: {
                participants: {
                    where: {
                        userId: user.id,
                        leftAt: null,
                    },
                },
            },
        });

        for (const conversation of conversations) {
            if (conversation.participants.length > 0) {
                client.join(this.getRoomName(conversation));
            }
        }

        client.emit('orgChatJoined', { organizationId });
        console.log(`[ChatGateway] User ${user.id} joined org chat for organization ${organizationId}`);
    }

    /**
     * Helper method to emit to a conversation room
     */
    emitToConversation(conversationId: string, event: string, data: any) {
        // This method can be called from services to emit events
        // We need to get the conversation to determine the room name
        // For now, we'll use a generic room name pattern
        this.server.to(`conversation:${conversationId}`).emit(event, data);
    }
}
