import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { TaskStatus, ExternalProvider } from 'generated/prisma/enums';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
    constructor(private readonly databaseService: DatabaseService) { }

    /**
     * Get organization ID from project ID
     */
    private async getProjectOrg(projectId: string) {
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId },
            select: { organizationId: true },
        });
        if (!project) {
            throw new NotFoundException(`Project ${projectId} not found`);
        }
        return project.organizationId;
    }

    /**
     * Create task
     */
    async createTask(projectId: string, data: CreateTaskDto, createdByUserId: string) {
        const organizationId = await this.getProjectOrg(projectId);

        // Resolve authorMemberId if autoDetectedFromId is provided
        let autoDetectedByMemberId: string | null = null;
        if (data.autoDetectedFromId) {
            const rawEvent = await this.databaseService.rawEvent.findUnique({
                where: { id: data.autoDetectedFromId },
                select: { authorMemberId: true },
            });
            autoDetectedByMemberId = rawEvent?.authorMemberId || null;
        }

        // Calculate isOverdue
        const isOverdue =
            data.completionDeadline && new Date(data.completionDeadline) < new Date()
                ? data.status !== TaskStatus.DONE
                : false;

        const task = await this.databaseService.task.create({
            data: {
                projectId,
                title: data.title,
                description: data.description || undefined,
                status: data.status || TaskStatus.TODO,
                priority: data.priority || undefined,
                dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
                completionDeadline: data.completionDeadline ? new Date(data.completionDeadline) : undefined,
                isOverdue,
                provider: data.provider || undefined,
                providerId: data.providerId || undefined,
                autoDetectedFromId: data.autoDetectedFromId || undefined,
                autoDetectedByMemberId: autoDetectedByMemberId || undefined,
                source: data.autoDetectedFromId ? 'AUTO_DETECTED' : 'MANUAL',
            },
            include: {
                assignedTo: {
                    where: { isActive: true },
                    include: { assignee: true, team: true },
                },
                taskTeam: {
                    include: {
                        members: {
                            include: { member: true },
                            where: { removedAt: null },
                        },
                    },
                },
            },
        });

        return task;
    }

    /**
     * Update task
     */
    async updateTask(taskId: string, data: UpdateTaskDto, userId: string) {
        const task = await this.databaseService.task.findUnique({
            where: { id: taskId },
            select: { id: true, projectId: true, status: true, completionDeadline: true },
        });

        if (!task) {
            throw new NotFoundException(`Task ${taskId} not found`);
        }

        // Calculate isOverdue
        const completionDeadline = data.completionDeadline ? new Date(data.completionDeadline) : task.completionDeadline;
        const status = data.status || task.status;
        const isOverdue = completionDeadline && completionDeadline < new Date() ? status !== TaskStatus.DONE : false;

        // Set completedAt if status changed to DONE
        let completedAt = task.status === TaskStatus.DONE ? undefined : undefined;
        if (data.status === TaskStatus.DONE && task.status !== TaskStatus.DONE) {
            completedAt = new Date();
        } else if (data.status && data.status !== TaskStatus.DONE && task.status === TaskStatus.DONE) {
            completedAt = null; // Reset if moving away from DONE
        }

        const updated = await this.databaseService.task.update({
            where: { id: taskId },
            data: {
                title: data.title,
                description: data.description,
                status: data.status,
                priority: data.priority,
                dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
                completionDeadline: data.completionDeadline ? new Date(data.completionDeadline) : undefined,
                isOverdue,
                completedAt,
            },
            include: {
                assignedTo: {
                    where: { isActive: true },
                    include: { assignee: true, team: true },
                },
                taskTeam: {
                    include: {
                        members: {
                            include: { member: true },
                            where: { removedAt: null },
                        },
                    },
                },
            },
        });

        return updated;
    }

    /**
     * Delete task
     */
    async deleteTask(taskId: string, userId: string) {
        const task = await this.databaseService.task.findUnique({
            where: { id: taskId },
        });

        if (!task) {
            throw new NotFoundException(`Task ${taskId} not found`);
        }

        await this.databaseService.task.delete({
            where: { id: taskId },
        });

        return { message: 'Task deleted successfully' };
    }

    /**
     * Assign task to member
     */
    async assignTask(taskId: string, assigneeId: string, assignedById: string) {
        const task = await this.databaseService.task.findUnique({
            where: { id: taskId },
        });

        if (!task) {
            throw new NotFoundException(`Task ${taskId} not found`);
        }

        // Deactivate existing assignments
        await this.databaseService.taskAssignment.updateMany({
            where: { taskId, isActive: true },
            data: { isActive: false, unassignedAt: new Date() },
        });

        // Create new assignment
        const assignment = await this.databaseService.taskAssignment.create({
            data: {
                taskId,
                assigneeId,
                assignedById,
                isActive: true,
            },
            include: {
                assignee: true,
            },
        });

        return assignment;
    }

    /**
     * Assign task to team
     */
    async assignTaskToTeam(taskId: string, teamId: string, assignedById: string) {
        const task = await this.databaseService.task.findUnique({
            where: { id: taskId },
        });

        if (!task) {
            throw new NotFoundException(`Task ${taskId} not found`);
        }

        const team = await this.databaseService.taskTeam.findUnique({
            where: { id: teamId },
        });

        if (!team) {
            throw new NotFoundException(`Task team ${teamId} not found`);
        }

        if (team.taskId !== taskId) {
            throw new BadRequestException('Team does not belong to this task');
        }

        // Deactivate existing assignments
        await this.databaseService.taskAssignment.updateMany({
            where: { taskId, isActive: true },
            data: { isActive: false, unassignedAt: new Date() },
        });

        // Create new assignment
        const assignment = await this.databaseService.taskAssignment.create({
            data: {
                taskId,
                teamId,
                assignedById,
                isActive: true,
            },
            include: {
                team: {
                    include: {
                        members: {
                            include: { member: true },
                            where: { removedAt: null },
                        },
                    },
                },
            },
        });

        return assignment;
    }

    /**
     * Create task team
     */
    async createTaskTeam(taskId: string, name: string, memberIds: string[], createdById: string) {
        const task = await this.databaseService.task.findUnique({
            where: { id: taskId },
        });

        if (!task) {
            throw new NotFoundException(`Task ${taskId} not found`);
        }

        // Check if team already exists
        const existingTeam = await this.databaseService.taskTeam.findUnique({
            where: { taskId },
        });

        if (existingTeam) {
            throw new BadRequestException('Task team already exists for this task');
        }

        // Create team
        const team = await this.databaseService.taskTeam.create({
            data: {
                taskId,
                name,
                members: {
                    create: memberIds.map((memberId) => ({
                        memberId,
                    })),
                },
            },
            include: {
                members: {
                    include: { member: true },
                },
            },
        });

        return team;
    }

    /**
     * Add team member
     */
    async addTaskTeamMember(teamId: string, memberId: string, role?: string) {
        const team = await this.databaseService.taskTeam.findUnique({
            where: { id: teamId },
        });

        if (!team) {
            throw new NotFoundException(`Task team ${teamId} not found`);
        }

        // Check if member already in team
        const existing = await this.databaseService.taskTeamMember.findUnique({
            where: {
                teamId_memberId: {
                    teamId,
                    memberId,
                },
            },
        });

        if (existing) {
            if (existing.removedAt) {
                // Re-add removed member
                await this.databaseService.taskTeamMember.update({
                    where: { id: existing.id },
                    data: {
                        removedAt: null,
                        role: role || existing.role,
                    },
                });
            } else {
                throw new BadRequestException('Member already in team');
            }
        } else {
            await this.databaseService.taskTeamMember.create({
                data: {
                    teamId,
                    memberId,
                    role: role || undefined,
                },
            });
        }

        return this.getTaskTeam(teamId);
    }

    /**
     * Remove team member
     */
    async removeTaskTeamMember(teamId: string, memberId: string) {
        const teamMember = await this.databaseService.taskTeamMember.findUnique({
            where: {
                teamId_memberId: {
                    teamId,
                    memberId,
                },
            },
        });

        if (!teamMember || teamMember.removedAt) {
            throw new NotFoundException('Team member not found or already removed');
        }

        await this.databaseService.taskTeamMember.update({
            where: { id: teamMember.id },
            data: { removedAt: new Date() },
        });

        return { message: 'Team member removed successfully' };
    }

    /**
     * Update task status
     */
    async updateTaskStatus(taskId: string, status: TaskStatus, userId: string) {
        const task = await this.databaseService.task.findUnique({
            where: { id: taskId },
            select: { id: true, status: true, completionDeadline: true },
        });

        if (!task) {
            throw new NotFoundException(`Task ${taskId} not found`);
        }

        const isOverdue = task.completionDeadline && task.completionDeadline < new Date() ? status !== TaskStatus.DONE : false;
        const completedAt = status === TaskStatus.DONE ? new Date() : task.status === TaskStatus.DONE ? undefined : null;

        // Get user's organization member ID
        const org = await this.getProjectOrg((await this.databaseService.task.findUnique({ where: { id: taskId }, select: { projectId: true } }))!.projectId);
        const member = await this.databaseService.organizationMember.findFirst({
            where: { userId, organizationId: org },
        });

        const updated = await this.databaseService.task.update({
            where: { id: taskId },
            data: {
                status,
                isOverdue,
                completedAt,
                completedByMemberId: status === TaskStatus.DONE && member ? member.id : undefined,
            },
            include: {
                assignedTo: {
                    where: { isActive: true },
                    include: { assignee: true, team: true },
                },
                taskTeam: {
                    include: {
                        members: {
                            include: { member: true },
                            where: { removedAt: null },
                        },
                    },
                },
            },
        });

        return updated;
    }

    /**
     * Link RawEvent to task
     */
    async linkRawEventToTask(taskId: string, rawEventId: string, relationship: string, relevance: number = 1.0) {
        const task = await this.databaseService.task.findUnique({
            where: { id: taskId },
        });

        if (!task) {
            throw new NotFoundException(`Task ${taskId} not found`);
        }

        const rawEvent = await this.databaseService.rawEvent.findUnique({
            where: { id: rawEventId },
        });

        if (!rawEvent) {
            throw new NotFoundException(`RawEvent ${rawEventId} not found`);
        }

        const link = await this.databaseService.taskRawEvent.upsert({
            where: {
                taskId_rawEventId: {
                    taskId,
                    rawEventId,
                },
            },
            update: {
                relationship,
                relevance,
            },
            create: {
                taskId,
                rawEventId,
                relationship,
                relevance,
            },
            include: {
                rawEvent: true,
            },
        });

        return link;
    }

    /**
     * Get tasks with filters
     */
    async getTasks(
        projectId: string,
        filters: {
            status?: TaskStatus;
            assigneeId?: string;
            priority?: number;
            limit?: number;
            offset?: number;
        },
    ) {
        const tasks = await this.databaseService.task.findMany({
            where: {
                projectId,
                ...(filters.status ? { status: filters.status } : {}),
                ...(filters.assigneeId
                    ? {
                          assignedTo: {
                              some: {
                                  assigneeId: filters.assigneeId,
                                  isActive: true,
                              },
                          },
                      }
                    : {}),
                ...(filters.priority ? { priority: filters.priority } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: filters.limit || 50,
            skip: filters.offset || 0,
            include: {
                assignedTo: {
                    where: { isActive: true },
                    include: { assignee: true, team: true },
                },
                taskTeam: {
                    include: {
                        members: {
                            include: { member: true },
                            where: { removedAt: null },
                        },
                    },
                },
            },
        });

        return tasks;
    }

    /**
     * Get task details
     */
    async getTask(taskId: string) {
        const task = await this.databaseService.task.findUnique({
            where: { id: taskId },
            include: {
                assignedTo: {
                    where: { isActive: true },
                    include: { assignee: true, team: true },
                },
                taskTeam: {
                    include: {
                        members: {
                            include: { member: true },
                            where: { removedAt: null },
                        },
                    },
                },
                rawEvents: {
                    include: { rawEvent: true },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        if (!task) {
            throw new NotFoundException(`Task ${taskId} not found`);
        }

        return task;
    }

    /**
     * Get task team
     */
    async getTaskTeam(teamId: string) {
        const team = await this.databaseService.taskTeam.findUnique({
            where: { id: teamId },
            include: {
                members: {
                    include: { member: true },
                    where: { removedAt: null },
                },
                task: true,
            },
        });

        if (!team) {
            throw new NotFoundException(`Task team ${teamId} not found`);
        }

        return team;
    }
}
