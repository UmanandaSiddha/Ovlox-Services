import {
    Controller,
    Post,
    Get,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName, TaskStatus } from 'generated/prisma/enums';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskTeamDto } from './dto/create-task-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { LinkEventDto } from './dto/link-event.dto';
import { DatabaseService } from 'src/services/database/database.service';

@Controller('orgs/:orgId/projects/:projectId/tasks')
@UseGuards(AuthGuard, PermissionGuard)
export class TasksController {
    constructor(
        private readonly tasksService: TasksService,
        private readonly databaseService: DatabaseService,
    ) { }

    @Post()
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async createTask(
        @Param('projectId') projectId: string,
        @Body() dto: CreateTaskDto,
        @getUser('id') userId: string,
    ) {
        return this.tasksService.createTask(projectId, dto, userId);
    }

    @Get()
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async getTasks(
        @Param('projectId') projectId: string,
        @Query('status') status?: TaskStatus,
        @Query('assigneeId') assigneeId?: string,
        @Query('priority') priority?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        return this.tasksService.getTasks(projectId, {
            status: status as TaskStatus,
            assigneeId,
            priority: priority ? parseInt(priority) : undefined,
            limit: limit ? parseInt(limit) : 50,
            offset: offset ? parseInt(offset) : 0,
        });
    }

    @Get(':id')
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async getTask(@Param('id') id: string) {
        return this.tasksService.getTask(id);
    }

    @Put(':id')
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async updateTask(
        @Param('id') id: string,
        @Body() dto: UpdateTaskDto,
        @getUser('id') userId: string,
    ) {
        return this.tasksService.updateTask(id, dto, userId);
    }

    @Delete(':id')
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async deleteTask(@Param('id') id: string, @getUser('id') userId: string) {
        return this.tasksService.deleteTask(id, userId);
    }

    @Post(':id/assign')
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async assignTask(
        @Param('id') id: string,
        @Body() dto: AssignTaskDto,
        @getUser('id') userId: string,
    ) {
        if (!dto.assigneeId && !dto.teamId) {
            throw new BadRequestException('Either assigneeId or teamId is required');
        }

        if (dto.assigneeId && dto.teamId) {
            throw new BadRequestException('Cannot assign to both assignee and team');
        }

        if (dto.assigneeId) {
            return this.tasksService.assignTask(id, dto.assigneeId, userId);
        } else {
            return this.tasksService.assignTaskToTeam(id, dto.teamId!, userId);
        }
    }

    @Post(':id/team')
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async createTaskTeam(
        @Param('id') id: string,
        @Body() dto: CreateTaskTeamDto,
        @getUser('id') userId: string,
    ) {
        return this.tasksService.createTaskTeam(id, dto.name, dto.memberIds, userId);
    }

    @Post(':id/team/members')
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async addTeamMember(
        @Param('id') id: string,
        @Body() dto: AddTeamMemberDto,
    ) {
        // Get team ID from task
        const task = await this.databaseService.task.findUnique({
            where: { id },
            select: { taskTeam: { select: { id: true } } },
        });

        if (!task || !task.taskTeam) {
            throw new BadRequestException('Task team not found for this task');
        }

        return this.tasksService.addTaskTeamMember(task.taskTeam.id, dto.memberId, dto.role);
    }

    @Delete(':id/team/members/:memberId')
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async removeTeamMember(@Param('id') id: string, @Param('memberId') memberId: string) {
        // Get team ID from task
        const task = await this.databaseService.task.findUnique({
            where: { id },
            select: { taskTeam: { select: { id: true } } },
        });

        if (!task || !task.taskTeam) {
            throw new BadRequestException('Task team not found for this task');
        }

        return this.tasksService.removeTaskTeamMember(task.taskTeam.id, memberId);
    }

    @Put(':id/status')
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async updateTaskStatus(
        @Param('id') id: string,
        @Body() body: { status: TaskStatus },
        @getUser('id') userId: string,
    ) {
        return this.tasksService.updateTaskStatus(id, body.status, userId);
    }

    @Post(':id/link-event')
    @RequirePermission(PermissionName.MANAGE_TASKS)
    async linkRawEvent(@Param('id') id: string, @Body() dto: LinkEventDto) {
        return this.tasksService.linkRawEventToTask(id, dto.rawEventId, dto.relationship, dto.relevance);
    }
}
