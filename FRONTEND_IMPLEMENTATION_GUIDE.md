# Frontend Implementation Guide

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [Authentication](#authentication)
3. [Organizations](#organizations)
4. [Projects](#projects)
5. [App Integrations](#app-integrations)
6. [RAG Chat Bot](#rag-chat-bot)

---

## Overview & Architecture

### Backend Architecture

The backend is built with **NestJS** and follows a modular architecture:

- **RESTful API** for standard CRUD operations
- **WebSocket (Socket.IO)** for real-time chat and notifications
- **Server-Sent Events (SSE)** for streaming job status updates
- **Queue-based processing** (BullMQ) for long-running LLM operations
- **Role-Based Access Control (RBAC)** with permission-based authorization

### Key Concepts

#### Authentication
- **JWT-based authentication** with access tokens (15min) and refresh tokens (7 days)
- Tokens are stored in **HTTP-only cookies** for security
- All authenticated endpoints require the `accessToken` cookie

#### Authorization
- **Permission-based access control** - users have permissions, not just roles
- Permissions are scoped to organizations or projects
- Each endpoint requires specific permissions (e.g., `VIEW_PROJECTS`, `MANAGE_ORG`)

#### Real-time Communication
- **WebSocket namespace**: `/chat` for real-time chat
- **SSE endpoints** for streaming job status
- Socket authentication via query parameter: `?token=<accessToken>`

#### Job Processing
- LLM operations (chat, reports) are **queued** for async processing
- Jobs are tracked in the database with status: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`
- Real-time updates via WebSocket events or SSE streams

### Base URL
```
API: http://localhost:3000/api/v1
WebSocket: ws://localhost:3000/chat
```

### Request Headers
All authenticated requests automatically include cookies. For manual token usage:
```
Authorization: Bearer <accessToken>
```

### Response Format
Most endpoints return:
```typescript
{
  success: boolean;
  message?: string;
  data?: any;
  count?: number;
  totalCount?: number;
  totalPages?: number;
}
```

### Error Format
```typescript
{
  statusCode: number;
  message: string | string[];
  error: string;
}
```

---

## Authentication

### Authentication Flow

The authentication system uses **OTP (One-Time Password)** or **password-based** sign-up/login with JWT tokens stored in HTTP-only cookies.

### UX Flow

1. **Sign Up Flow**:
   - User enters email/phone + password + name
   - System creates account and sends OTP
   - User verifies OTP to complete registration
   - Tokens are automatically set in cookies

2. **Login Flow**:
   - User enters email/phone + password
   - System validates credentials
   - Tokens are automatically set in cookies

3. **Token Refresh**:
   - Access token expires in 15 minutes
   - Frontend should call refresh endpoint before expiration
   - Refresh token expires in 7 days

### API Endpoints

#### 1. Request OTP
**POST** `/auth/request-otp`

**Description**: Request OTP for existing user (used for password reset or verification)

**Request Body**:
```typescript
{
  email?: string;        // Either email or phoneNumber required
  phoneNumber?: string;  // Either email or phoneNumber required
}
```

**Response**:
```typescript
{
  message: string;  // "OTP sent successfully!!"
  success: boolean; // true
}
```

**UX Notes**:
- Show loading state while OTP is being sent
- Display success message
- In development, OTP is always `000000`

---

#### 2. Sign Up
**POST** `/auth/sign-up`

**Description**: Create a new user account

**Request Body**:
```typescript
{
  email?: string;        // Either email or phoneNumber required
  phoneNumber?: string;  // Either email or phoneNumber required
  firstName: string;     // Required
  lastName: string;     // Required
  password: string;     // Required
}
```

**Response**:
- Sets `accessToken` and `refreshToken` cookies
- Returns user object:
```typescript
{
  user: {
    id: string;
    email: string | null;
    phoneNumber: string | null;
    firstName: string;
    lastName: string;
    role: "ADMIN" | "USER";
    // ... other fields
  }
}
```

**UX Notes**:
- After sign-up, user is automatically logged in
- Redirect to organization creation or dashboard
- Show validation errors for duplicate email/phone

---

#### 3. Sign In
**POST** `/auth/sign-in`

**Description**: Authenticate existing user

**Request Body**:
```typescript
{
  email?: string;        // Either email or phoneNumber required
  phoneNumber?: string;  // Either email or phoneNumber required
  password: string;     // Required
}
```

**Response**:
- Sets `accessToken` and `refreshToken` cookies
- Returns user object (same as sign-up)

**UX Notes**:
- Show loading state during authentication
- Display error for invalid credentials
- On success, redirect to dashboard

---

#### 4. Verify OTP
**POST** `/auth/verify-otp`

**Description**: Verify OTP for password reset or account verification

**Request Body**:
```typescript
{
  email?: string;        // Either email or phoneNumber required
  phoneNumber?: string;  // Either email or phoneNumber required
  otp: string;          // 6-digit OTP
}
```

**Response**:
- Sets `accessToken` and `refreshToken` cookies
- Returns user object

**UX Notes**:
- Used for password reset flow or account verification
- Show error for invalid/expired OTP
- Auto-redirect on success

---

#### 5. Refresh Token
**GET** `/auth/refresh-token`

**Description**: Refresh access token using refresh token from cookie

**Request**: No body, uses `refreshToken` cookie

**Response**:
- Sets new `accessToken` cookie
- Returns success message

**UX Notes**:
- Call this automatically before access token expires (every 14 minutes)
- If refresh fails, redirect to login
- Implement automatic token refresh in HTTP interceptor

---

#### 6. Logout
**PUT** `/auth/logout`

**Description**: Logout user and invalidate session

**Request**: No body, requires authentication

**Response**:
```typescript
{
  message: string; // "Logged out successfully"
}
```

**UX Notes**:
- Clears cookies on backend
- Frontend should also clear any stored user data
- Redirect to login page

---

### Frontend Implementation Notes

1. **Cookie Management**:
   - Cookies are automatically sent with requests
   - No need to manually add tokens to headers
   - Ensure cookies are sent in cross-origin requests (credentials: 'include')

2. **Token Refresh Strategy**:
   ```typescript
   // Intercept 401 responses
   // Call /auth/refresh-token
   // Retry original request
   // If refresh fails, redirect to login
   ```

3. **Protected Routes**:
   - Check for valid access token before rendering
   - Redirect to login if token is missing/invalid
   - Show loading state during token validation

4. **User State Management**:
   - Store user object in state (Redux/Zustand/Context)
   - Fetch user details on app load if token exists
   - Clear user state on logout

---

## Organizations

### Organization Model

Organizations are the top-level entity that groups users, projects, and integrations. Users can be members of multiple organizations with different roles and permissions.

### UX Flow

1. **Create Organization**:
   - User creates org with name
   - Optionally invite members during creation
   - Optionally select app providers to integrate
   - User becomes OWNER automatically

2. **Organization Dashboard**:
   - List all organizations user belongs to
   - Show organization details, members, projects
   - Display integration status

3. **Member Management**:
   - Invite members via email
   - Assign roles (OWNER, ADMIN, DEVELOPER, VIEWER, etc.)
   - View pending invites
   - Remove members

### API Endpoints

#### 1. Create Organization
**POST** `/orgs/create`

**Description**: Create a new organization

**Request Body**:
```typescript
{
  name: string;                    // Required: Organization name
  inviteMembers?: Array<{          // Optional: Invite members during creation
    email: string;
    predefinedRole: "OWNER" | "ADMIN" | "DEVELOPER" | "VIEWER" | "CEO" | "CTO";
  }>;
  appProviders?: Array<{           // Optional: Pre-select integrations
    provider: "GITHUB" | "SLACK" | "DISCORD" | "NOTION" | "JIRA" | "FIGMA";
  }>;
}
```

**Response**:
```typescript
{
  message: string;
  organization: {
    id: string;
    name: string;
    slug: string;              // URL-friendly identifier
    ownerId: string;
    creditBalance: number;
    createdAt: string;
    updatedAt: string;
    members: Array<{...}>;
    projects: Array<{...}>;
    integrations: Array<{...}>;
  }
}
```

**UX Notes**:
- Show form with name input
- Optional: Multi-select for app providers
- Optional: Add email inputs for member invites
- On success, redirect to organization dashboard
- Slug is auto-generated from name

---

#### 2. List User Organizations
**GET** `/orgs/user`

**Description**: Get all organizations where user is a member

**Query Parameters**:
```typescript
{
  limit?: number;      // Pagination limit (default: 10)
  page?: number;       // Page number
  search?: string;     // Search by organization name
  sort?: string;       // Sort field (e.g., "createdAt:desc")
}
```

**Response**:
```typescript
{
  success: boolean;
  count: number;
  totalCount: number;
  totalPages: number;
  data: Array<{
    id: string;
    name: string;
    slug: string;
    members: Array<{...}>;
    projects: Array<{...}>;
    integrations: Array<{...}>;
    // ... other fields
  }>;
}
```

**UX Notes**:
- Display as cards or list
- Show member count, project count
- Show integration status indicators
- Implement pagination
- Add search functionality

---

#### 3. Get Organization by ID
**GET** `/orgs/user/byId/:id`

**Description**: Get organization details by ID

**Response**:
```typescript
{
  message: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    members: Array<{
      id: string;
      userId: string;
      predefinedRole: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
      };
    }>;
    projects: Array<{...}>;
    integrations: Array<{...}>;
  }
}
```

**UX Notes**:
- Use for organization detail page
- Show full member list with roles
- Display all projects
- Show integration status

---

#### 4. Get Organization by Slug
**GET** `/orgs/user/bySlug/:slug`

**Description**: Get organization details by slug (URL-friendly identifier)

**Response**: Same as Get Organization by ID

**UX Notes**:
- Use for organization URLs: `/orgs/{slug}`
- Slug is auto-generated and unique

---

#### 5. Update Organization
**PUT** `/orgs/:orgId`

**Description**: Update organization details (requires `MANAGE_ORG` permission)

**Request Body**:
```typescript
{
  name?: string;  // Optional: Update organization name
}
```

**Response**: Updated organization object

**UX Notes**:
- Only show to users with `MANAGE_ORG` permission
- Show edit form/modal
- Update slug automatically if name changes

---

#### 6. Delete Organization
**DELETE** `/orgs/:orgId`

**Description**: Delete organization (requires `MANAGE_ORG` permission)

**Response**: Success message

**UX Notes**:
- Show confirmation dialog
- Only available to OWNER
- Warn about data loss
- Redirect to organization list after deletion

---

#### 7. Invite Member
**POST** `/orgs/:orgId/members/invite`

**Description**: Invite a new member to organization (requires `INVITE_MEMBERS` permission)

**Request Body**:
```typescript
{
  email: string;
  predefinedRole?: "OWNER" | "ADMIN" | "DEVELOPER" | "VIEWER" | "CEO" | "CTO";
  roleId?: string;  // Optional: Custom role ID
}
```

**Response**: Invite object with token

**UX Notes**:
- Show invite form with email and role selector
- Send email invitation automatically
- Show pending invites list
- Display success message

---

#### 8. List Members
**GET** `/orgs/:orgId/members`

**Description**: Get all organization members (requires `VIEW_PROJECTS` permission)

**Query Parameters**: Same pagination/search as organization list

**Response**:
```typescript
{
  success: boolean;
  count: number;
  totalCount: number;
  data: Array<{
    id: string;
    userId: string;
    predefinedRole: string;
    status: "INVITED" | "ACTIVE" | "SUSPENDED";
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      avatarUrl: string | null;
    };
  }>;
}
```

**UX Notes**:
- Display member list with avatars
- Show role badges
- Show status (Active/Invited/Suspended)
- Add search/filter functionality

---

#### 9. Update Member Role
**PUT** `/orgs/:orgId/members/:memberId`

**Description**: Update member's role (requires `MANAGE_ROLES` permission)

**Request Body**:
```typescript
{
  predefinedRole?: "OWNER" | "ADMIN" | "DEVELOPER" | "VIEWER" | "CEO" | "CTO";
  roleId?: string;  // Optional: Custom role ID
}
```

**Response**: Updated member object

**UX Notes**:
- Show role selector dropdown
- Update role in real-time
- Show confirmation for role changes

---

#### 10. Remove Member
**DELETE** `/orgs/:orgId/members/:memberId`

**Description**: Remove member from organization (requires `INVITE_MEMBERS` permission)

**Response**: Success message

**UX Notes**:
- Show confirmation dialog
- Remove from list after confirmation
- Cannot remove OWNER

---

#### 11. List Invites
**GET** `/orgs/:orgId/invites`

**Description**: Get all pending invites (requires `INVITE_MEMBERS` permission)

**Query Parameters**: Same pagination as other list endpoints

**Response**:
```typescript
{
  success: boolean;
  count: number;
  data: Array<{
    id: string;
    email: string;
    token: string;
    predefinedRole: string;
    status: "PENDING" | "ACCEPTED" | "EXPIRED";
    invitedBy: string;
    createdAt: string;
  }>;
}
```

**UX Notes**:
- Show pending invites table
- Show invite status
- Option to resend invite
- Option to cancel invite

---

#### 12. Accept Invite
**POST** `/orgs/invites/:token/accept`

**Description**: Accept organization invitation

**Request**: No body, uses invite token from URL

**Response**: Organization member object

**UX Notes**:
- User clicks invite link: `/invites/accept?token={token}`
- Show organization details before accepting
- On accept, add user to organization
- Redirect to organization dashboard

---

#### 13. Integration Status (SSE)
**SSE** `/orgs/integration/status/:slug`

**Description**: Stream integration connection status updates

**Response**: Server-Sent Events with integration status:
```typescript
{
  integrations: Array<{
    id: string;
    type: "GITHUB" | "SLACK" | "DISCORD" | "NOTION" | "JIRA" | "FIGMA";
    status: "NOT_CONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
    // ... other fields
  }>;
}
```

**UX Notes**:
- Connect to SSE endpoint when viewing organization
- Update integration status indicators in real-time
- Show connection progress
- Auto-reconnect on disconnect

---

### Frontend Implementation Notes

1. **Permission Checking**:
   - Check user permissions before showing action buttons
   - Hide/disable features user doesn't have access to
   - Show permission error messages

2. **Organization Context**:
   - Store current organization in global state
   - Update URL: `/orgs/{slug}/...`
   - Persist selected organization in localStorage

3. **Real-time Updates**:
   - Use SSE for integration status
   - Poll member list for updates
   - Show notifications for new invites

4. **Member Management UI**:
   - Table view with sortable columns
   - Role badges with color coding
   - Avatar placeholders for users without avatars
   - Bulk actions (if needed)

---

## Projects

### Project Model

Projects belong to organizations and contain integrations, conversations, and reports. Projects are where RAG chat happens - users can chat with project-specific data sources.

### UX Flow

1. **Create Project**:
   - Select organization
   - Enter project name and description
   - Project is created with slug

2. **Project Dashboard**:
   - View project details
   - See linked integrations
   - Access available resources (repos, channels, etc.)
   - Start RAG chat

3. **Link Integrations**:
   - Select integration from organization
   - Choose specific resources (repos, channels, databases)
   - Link to project

### API Endpoints

#### 1. Create Project
**POST** `/orgs/:orgId/projects`

**Description**: Create a new project in organization (requires `CREATE_PROJECTS` permission)

**Request Body**:
```typescript
{
  name: string;           // Required: Project name
  description?: string;   // Optional: Project description
}
```

**Response**:
```typescript
{
  id: string;
  name: string;
  slug: string;           // URL-friendly identifier
  description: string | null;
  organizationId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

**UX Notes**:
- Show form with name and description inputs
- Auto-generate slug from name
- On success, redirect to project dashboard
- Show validation errors

---

#### 2. List Projects
**GET** `/orgs/:orgId/projects`

**Description**: Get all projects in organization (requires `VIEW_PROJECTS` permission)

**Query Parameters**:
```typescript
{
  limit?: number;      // Pagination limit
  page?: number;       // Page number
  search?: string;     // Search by project name
  sort?: string;       // Sort field
}
```

**Response**:
```typescript
{
  success: boolean;
  count: number;
  totalCount: number;
  totalPages: number;
  data: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    organizationId: string;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

**UX Notes**:
- Display as cards or list
- Show project name, description
- Add search and filter
- Implement pagination
- Link to project detail page

---

#### 3. Get Project
**GET** `/orgs/:orgId/projects/:id`

**Description**: Get project details (requires `VIEW_PROJECTS` permission)

**Response**: Project object with all fields

**UX Notes**:
- Use for project detail page
- Show project information
- Display linked integrations
- Show available resources

---

#### 4. Update Project
**PUT** `/orgs/:orgId/projects/:id`

**Description**: Update project details (requires `EDIT_PROJECTS` permission)

**Request Body**:
```typescript
{
  name?: string;           // Optional: Update project name
  description?: string;   // Optional: Update description
}
```

**Response**: Updated project object

**UX Notes**:
- Show edit form/modal
- Update slug if name changes
- Show success message

---

#### 5. Delete Project
**DELETE** `/orgs/:orgId/projects/:id`

**Description**: Delete project (requires `DELETE_PROJECTS` permission)

**Response**: Success message

**UX Notes**:
- Show confirmation dialog
- Warn about data loss (conversations, reports)
- Redirect to project list after deletion

---

#### 6. Link Integration to Project
**POST** `/orgs/:orgId/projects/:id/link-integration`

**Description**: Link integration resources to project (requires `EDIT_PROJECTS` permission)

**Request Body**:
```typescript
{
  integrationId: string;  // Integration ID from organization
  items: any;            // Resource items to link (structure varies by provider)
}
```

**Example for GitHub**:
```typescript
{
  integrationId: "uuid",
  items: {
    repositories: ["repo1", "repo2"]  // Repository IDs or names
  }
}
```

**Example for Slack/Discord**:
```typescript
{
  integrationId: "uuid",
  items: {
    channels: ["channel1", "channel2"]  // Channel IDs
  }
}
```

**Response**: Success message with linked resources

**UX Notes**:
- Show integration selector (from organization)
- Display available resources for selected integration
- Multi-select resources (repos, channels, etc.)
- Show linked resources after success
- Update project resources list

---

#### 7. Get Available Resources
**GET** `/orgs/:orgId/projects/:id/resources`

**Description**: Get all available resources from linked integrations (requires `VIEW_PROJECTS` permission)

**Response**:
```typescript
{
  integrations: Array<{
    id: string;
    type: "GITHUB" | "SLACK" | "DISCORD" | "NOTION" | "JIRA" | "FIGMA";
    resources: Array<{
      id: string;
      name: string;
      type: string;  // "repository", "channel", "database", etc.
      // ... provider-specific fields
    }>;
  }>;
}
```

**UX Notes**:
- Display resources grouped by integration
- Show resource type icons
- Allow filtering by integration type
- Show resource count per integration
- Use for data source selection in RAG chat

---

### Frontend Implementation Notes

1. **Project Context**:
   - Store current project in global state
   - Update URL: `/orgs/{orgSlug}/projects/{projectSlug}`
   - Persist selected project

2. **Integration Linking UI**:
   - Show integration cards with status
   - Display resource picker modal
   - Multi-select with checkboxes
   - Show linked resources count

3. **Resource Display**:
   - Group by integration type
   - Show resource icons
   - Display resource metadata
   - Allow filtering/searching

4. **Permission-based UI**:
   - Hide edit/delete buttons without permissions
   - Show read-only view for viewers
   - Disable actions user can't perform

---

## App Integrations

### Integration Model

Integrations connect external services (GitHub, Slack, Discord, Jira, Notion, Figma) to organizations. Each integration allows projects to access data from these services for RAG chat.

### Integration Flow

1. **Create Integration** (during org creation or later):
   - Select provider type
   - Integration record created with `NOT_CONNECTED` status

2. **Connect Integration**:
   - Get installation URL from provider endpoint
   - Redirect user to OAuth/installation page
   - User authorizes on provider's site
   - Callback updates integration status to `CONNECTED`

3. **Select Resources**:
   - Fetch available resources (repos, channels, etc.)
   - Sync resources to database
   - Link resources to projects

4. **Ingest Data**:
   - Start historical data ingestion
   - Data is processed and stored for RAG

### Supported Providers

- **GitHub**: Repositories, commits, pull requests, issues
- **Slack**: Channels, messages
- **Discord**: Guilds, channels, messages
- **Jira**: Projects, issues
- **Notion**: Databases, pages
- **Figma**: Files, comments, versions

### Common Integration Endpoints

All providers follow similar patterns. Provider-specific endpoints are documented below.

---

### GitHub Integration

#### 1. Get OAuth URL
**GET** `/integrations/github/oauth/:orgId`

**Description**: Get GitHub OAuth URL for organization

**Response**:
```typescript
{
  url: string;  // OAuth URL to redirect user
}
```

**UX Notes**:
- Show "Connect GitHub" button
- Redirect user to returned URL
- User authorizes on GitHub
- Callback redirects to frontend

---

#### 2. Get Installation URL
**GET** `/integrations/github/install/:orgId`

**Description**: Get GitHub App installation URL (preferred method)

**Response**:
```typescript
{
  message: string;
  url: string;  // Installation URL
}
```

**UX Notes**:
- Use for GitHub App installation
- Redirect to installation URL
- User selects repositories to grant access
- Callback updates integration

---

#### 3. GitHub Callback
**GET** `/integrations/github/callback`

**Description**: OAuth callback (handled automatically, redirects to frontend)

**Query Parameters**: `code`, `state`, `installation_id`, `setup_action`

**Response**: HTML redirect to frontend with status

**UX Notes**:
- Backend handles this automatically
- Frontend receives redirect: `/integrations?status=connected`
- Show success message
- Update integration status

---

#### 4. Get Installation Repositories
**GET** `/integrations/github/repo/:integrationId`

**Description**: Get repositories available for integration

**Response**: Array of repository objects

**UX Notes**:
- Show repository list
- Allow selecting repositories
- Display repository metadata (name, description, etc.)

---

#### 5. Sync Repositories
**POST** `/integrations/github/sync-repos/:integrationId`

**Description**: Sync repositories from GitHub to database

**Response**: Success message with synced count

**UX Notes**:
- Show loading state
- Display sync progress
- Update repository list after sync

---

#### 6. Get Repository Overview
**GET** `/integrations/github/overview/:integrationId`

**Description**: Get GitHub integration overview (commits, PRs, issues count)

**Response**: Overview statistics

**UX Notes**:
- Display in integration dashboard
- Show activity metrics

---

#### 7. Ingest Repository Data
**POST** `/integrations/github/ingest/:integrationId`

**Description**: Start historical data ingestion (commits, PRs, issues)

**Query Parameters**:
```typescript
{
  repoId?: string;  // Optional: Specific repository
}
```

**Response**: Ingestion job object

**UX Notes**:
- Show ingestion progress
- Display job status
- Notify when complete

---

### Slack Integration

#### 1. Get Install URL
**GET** `/integrations/slack/install/:orgId/:integrationId`

**Description**: Get Slack OAuth URL

**Response**:
```typescript
{
  url: string;
}
```

**UX Notes**:
- Redirect to Slack authorization
- User authorizes workspace access
- Callback updates integration

---

#### 2. Get Channels
**GET** `/integrations/slack/channels/:integrationId`

**Description**: Get Slack channels

**Response**: Array of channel objects

**UX Notes**:
- Show channel list
- Allow selecting channels
- Display channel metadata

---

#### 3. Sync Channels
**POST** `/integrations/slack/sync-channels/:integrationId`

**Description**: Sync channels from Slack

**Response**: Success message

**UX Notes**:
- Update channel list
- Show sync status

---

#### 4. Ingest Channel History
**POST** `/integrations/slack/ingest/:integrationId`

**Query Parameters**:
```typescript
{
  channelId: string;      // Required: Channel ID
  projectId?: string;    // Optional: Link to project
}
```

**Response**: Ingestion job object

**UX Notes**:
- Select channel from list
- Start ingestion
- Show progress

---

### Discord Integration

#### 1. Get Install URL
**GET** `/integrations/discord/install/:orgId/:integrationId`

**Description**: Get Discord bot installation URL

**Response**:
```typescript
{
  url: string;
}
```

**UX Notes**:
- Redirect to Discord authorization
- User selects server (guild)
- Bot is added to server

---

#### 2. Get Channels
**GET** `/integrations/discord/channels/:integrationId`

**Query Parameters**:
```typescript
{
  guildId: string;  // Required: Discord server ID
}
```

**Response**: Array of channel objects

**UX Notes**:
- First select guild (server)
- Then show channels
- Allow selecting channels

---

#### 3. Sync Channels
**POST** `/integrations/discord/sync-channels/:integrationId`

**Query Parameters**:
```typescript
{
  guildId: string;  // Required
}
```

**Response**: Success message

---

#### 4. Ingest Channel History
**POST** `/integrations/discord/ingest/:integrationId`

**Query Parameters**:
```typescript
{
  channelId: string;      // Required
  projectId?: string;    // Optional
}
```

**Response**: Ingestion job object

---

### Jira Integration

#### 1. Get Install URL
**GET** `/integrations/jira/install/:orgId/:integrationId`

**Description**: Get Jira OAuth URL

**Response**:
```typescript
{
  url: string;
}
```

---

#### 2. Get Projects
**GET** `/integrations/jira/projects/:integrationId`

**Description**: Get Jira projects

**Response**: Array of project objects

**UX Notes**:
- Show project list
- Allow selecting projects

---

#### 3. Sync Projects
**POST** `/integrations/jira/sync-projects/:integrationId`

**Description**: Sync Jira projects

**Response**: Success message

---

#### 4. Ingest Issues
**POST** `/integrations/jira/ingest/:integrationId`

**Query Parameters**:
```typescript
{
  projectKey?: string;  // Optional: Specific project
  jql?: string;        // Optional: JQL query filter
}
```

**Response**: Ingestion job object

**UX Notes**:
- Allow filtering by project
- Support JQL queries for advanced filtering

---

### Notion Integration

#### 1. Get Install URL
**GET** `/integrations/notion/install/:orgId/:integrationId`

**Description**: Get Notion OAuth URL

**Response**:
```typescript
{
  url: string;
}
```

---

#### 2. Get Databases
**GET** `/integrations/notion/databases/:integrationId`

**Description**: Get Notion databases

**Response**: Array of database objects

**UX Notes**:
- Show database list
- Allow selecting databases

---

#### 3. Sync Resources
**POST** `/integrations/notion/sync-resources/:integrationId`

**Description**: Sync Notion resources

**Response**: Success message

---

#### 4. Ingest Pages
**POST** `/integrations/notion/ingest/:integrationId`

**Query Parameters**:
```typescript
{
  databaseId?: string;  // Optional: Specific database
}
```

**Response**: Ingestion job object

---

### Figma Integration

#### 1. Get Install URL
**GET** `/integrations/figma/install/:orgId/:integrationId`

**Description**: Get Figma OAuth URL

**Response**:
```typescript
{
  url: string;
}
```

---

#### 2. Get Files
**GET** `/integrations/figma/files/:integrationId`

**Query Parameters**:
```typescript
{
  teamId?: string;  // Optional: Filter by team
}
```

**Response**: Array of file objects

**UX Notes**:
- Show file list
- Allow selecting files

---

#### 3. Sync Resources
**POST** `/integrations/figma/sync-resources/:integrationId`

**Query Parameters**:
```typescript
{
  teamId?: string;  // Optional
}
```

**Response**: Success message

---

#### 4. Ingest Files/Comments/Versions
**POST** `/integrations/figma/ingest/:integrationId`

**Query Parameters**:
```typescript
{
  fileKey?: string;  // Required for comments/versions
  type?: "files" | "comments" | "versions";  // Default: "files"
}
```

**Response**: Ingestion job object

**UX Notes**:
- Select ingestion type
- For comments/versions, require fileKey
- Show ingestion progress

---

### Frontend Implementation Notes

1. **Integration Status Management**:
   - Use SSE endpoint for real-time status updates
   - Show status indicators: Not Connected, Connecting, Connected, Error
   - Display connection progress

2. **OAuth Flow**:
   - Open OAuth URL in same window or popup
   - Handle callback redirect
   - Update integration status after callback
   - Show success/error messages

3. **Resource Selection UI**:
   - Multi-select interface
   - Group by resource type
   - Show resource metadata
   - Allow filtering/searching

4. **Ingestion Progress**:
   - Poll job status or use SSE
   - Show progress bar
   - Display estimated time remaining
   - Notify on completion

5. **Provider-Specific UI**:
   - Customize UI per provider
   - Show provider-specific metadata
   - Handle provider-specific errors

---

## RAG Chat Bot

### Chat Model

The RAG (Retrieval-Augmented Generation) chat system allows users to ask questions about project data. Chat messages are processed asynchronously via a queue, with real-time updates via WebSocket.

### Key Concepts

1. **Conversations**: Container for chat messages, can be project-specific or organization-level
2. **Messages**: User questions and AI responses
3. **Jobs**: LLM processing jobs tracked in database
4. **Real-time Updates**: WebSocket events for new messages and job status
5. **Sources**: References to data sources used in responses

### UX Flow

1. **Create/Select Conversation**:
   - User creates new conversation or selects existing
   - Conversation is linked to project (for RAG) or organization (for general chat)

2. **Send Message**:
   - User types question
   - Message is sent to backend
   - Backend queues LLM job
   - User message appears immediately
   - Show "processing" indicator

3. **Receive Response**:
   - LLM processes question using project data sources
   - Response is streamed via WebSocket
   - AI message appears with sources
   - Show loading state during processing

4. **View History**:
   - Load conversation history
   - Paginate messages
   - Show message sources

### WebSocket Connection

**Namespace**: `/chat`

**Connection URL**: `ws://localhost:3000/chat?token={accessToken}`

**Authentication**: Pass access token as query parameter

**Events**:
- `newMessage`: New message received
- `messageProcessing`: Message is being processed
- `typing`: User is typing
- `messageRead`: Message was read

### API Endpoints

#### 1. Create Conversation
**POST** `/chat/conversations`

**Description**: Create a new conversation

**Request Body**:
```typescript
{
  projectId?: string;        // Required for RAG_CHAT
  organizationId?: string;   // Required for ORG_CHAT
  title?: string;           // Optional: Conversation title
  type?: "RAG_CHAT" | "ORG_CHAT";  // Default: "RAG_CHAT"
}
```

**Response**:
```typescript
{
  id: string;
  type: "RAG_CHAT" | "ORG_CHAT";
  title: string;
  projectId: string | null;
  organizationId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

**UX Notes**:
- For RAG chat, require projectId
- Auto-generate title from first message if not provided
- Add user as participant automatically
- Redirect to conversation view

---

#### 2. List Conversations
**GET** `/chat/conversations`

**Description**: Get user's conversations

**Query Parameters**:
```typescript
{
  projectId?: string;        // Filter by project
  organizationId?: string;  // Filter by organization
}
```

**Response**: Array of conversation objects with last message:
```typescript
Array<{
  id: string;
  type: string;
  title: string;
  projectId: string | null;
  organizationId: string | null;
  messages: Array<{
    id: string;
    content: string;
    role: "USER" | "ASSISTANT";
    createdAt: string;
  }>;  // Last message only
  createdAt: string;
  updatedAt: string;
}>
```

**UX Notes**:
- Display as list with last message preview
- Show conversation title
- Show last message timestamp
- Filter by project/organization
- Sort by updatedAt (most recent first)

---

#### 3. Get Conversation
**GET** `/chat/conversations/:id`

**Description**: Get conversation with messages

**Response**:
```typescript
{
  id: string;
  type: string;
  title: string;
  projectId: string | null;
  organizationId: string | null;
  messages: Array<{
    id: string;
    content: string;
    role: "USER" | "ASSISTANT" | "SYSTEM";
    senderId: string | null;
    senderMemberId: string | null;
    sources: Array<{
      id: string;
      relevanceScore: number;
      rawEvent: {...} | null;    // Source data
      llmOutput: {...} | null;
    }>;
    createdAt: string;
  }>;
  project: {
    id: string;
    name: string;
    organization: {...};
  } | null;
  organization: {...} | null;
  createdAt: string;
  updatedAt: string;
}
```

**UX Notes**:
- Load conversation details
- Display all messages
- Show message sources
- Display project/organization context

---

#### 4. Update Conversation
**PUT** `/chat/conversations/:id`

**Description**: Update conversation title

**Request Body**:
```typescript
{
  title?: string;  // Optional: Update title
}
```

**Response**: Updated conversation object

**UX Notes**:
- Allow editing title
- Update in real-time
- Show edit form/modal

---

#### 5. Get Messages
**GET** `/chat/conversations/:id/messages`

**Description**: Get messages with pagination

**Query Parameters**:
```typescript
{
  limit?: number;   // Default: 50, max: 100
  before?: string;  // Message ID to fetch messages before
}
```

**Response**: Array of message objects (in chronological order)

**UX Notes**:
- Load more messages on scroll up
- Use `before` parameter for pagination
- Show loading state
- Display messages in chronological order

---

#### 6. Send Message
**POST** `/chat/conversations/:id/messages`

**Description**: Send a message (queues LLM job)

**Request Body**:
```typescript
{
  question: string;  // Required: User's question
}
```

**Response** (202 Accepted):
```typescript
{
  status: "processing";
  jobId: string;     // Job ID for tracking
  userMessage: {
    id: string;
    content: string;
    role: "USER";
    senderId: string;
    createdAt: string;
    sender: {
      id: string;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
    };
  };
  message: "Your message is being processed...";
}
```

**UX Notes**:
- Show user message immediately
- Display "processing" indicator
- Connect to WebSocket for updates
- Show typing indicator
- Handle errors gracefully

---

#### 7. Get Job Status
**GET** `/chat/jobs/:jobId/status`

**Description**: Get LLM job status

**Response**:
```typescript
{
  id: string;
  type: "llm_chat" | "llm_project_report";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "RETRY";
  attempts: number;
  payload: {
    conversationId: string;
    question: string;
    userId: string;
    projectId?: string;
    organizationId?: string;
    userMessageId: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

**UX Notes**:
- Poll this endpoint or use SSE
- Show job status
- Display error if failed
- Allow retry on failure

---

#### 8. Retry Job
**POST** `/chat/jobs/:jobId/retry`

**Description**: Retry a failed job

**Response**:
```typescript
{
  status: "queued";
  jobId: string;
  message: "Job has been queued for retry";
}
```

**UX Notes**:
- Show retry button for failed jobs
- Display loading state
- Update job status after retry

---

#### 9. Stream Job Status (SSE)
**SSE** `/chat/jobs/:jobId/stream`

**Description**: Stream job status updates

**Response**: Server-Sent Events:
```typescript
{
  jobId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  attempts: number;
  payload: {...};
  updatedAt: string;
  completed?: boolean;  // true when job finished
}
```

**UX Notes**:
- Connect to SSE endpoint
- Update UI on status changes
- Close connection when completed
- Handle reconnection

---

### WebSocket Events

#### Client → Server Events

##### Join Conversation
**Event**: `joinConversation`

**Payload**:
```typescript
{
  conversationId: string;
}
```

**Description**: Join a conversation room to receive messages

---

##### Leave Conversation
**Event**: `leaveConversation`

**Payload**:
```typescript
{
  conversationId: string;
}
```

**Description**: Leave a conversation room

---

##### Typing Indicator
**Event**: `typing`

**Payload**:
```typescript
{
  conversationId: string;
  isTyping: boolean;
}
```

**Description**: Send typing indicator

---

##### Mark Message as Read
**Event**: `markAsRead`

**Payload**:
```typescript
{
  conversationId: string;
  messageId: string;
}
```

**Description**: Mark message as read

---

#### Server → Client Events

##### New Message
**Event**: `newMessage`

**Payload**:
```typescript
{
  message: {
    id: string;
    content: string;
    role: "USER" | "ASSISTANT";
    senderId: string | null;
    senderMemberId: string | null;
    sources: Array<{...}>;
    createdAt: string;
  };
  conversationId: string;
}
```

**Description**: New message received (user or AI)

**UX Notes**:
- Append message to conversation
- Scroll to bottom
- Show message with proper styling
- Display sources for AI messages

---

##### Message Processing
**Event**: `messageProcessing`

**Payload**:
```typescript
{
  conversationId: string;
  userMessageId: string;
  jobId: string;
  status: "processing";
}
```

**Description**: Message is being processed by LLM

**UX Notes**:
- Show loading indicator
- Update message status
- Display "AI is thinking..." message

---

##### Typing Indicator
**Event**: `typing`

**Payload**:
```typescript
{
  conversationId: string;
  userId: string;
  userName: string;
  isTyping: boolean;
}
```

**Description**: User is typing

**UX Notes**:
- Show typing indicator
- Display user name
- Hide after timeout

---

##### Message Read
**Event**: `messageRead`

**Payload**:
```typescript
{
  conversationId: string;
  messageId: string;
  userId: string;
}
```

**Description**: Message was read by user

**UX Notes**:
- Update read status
- Show read receipts (if implemented)

---

### Frontend Implementation Notes

1. **WebSocket Connection**:
   ```typescript
   // Connect to WebSocket
   const socket = io('http://localhost:3000/chat', {
     query: { token: accessToken },
     transports: ['websocket']
   });
   
   // Join conversation
   socket.emit('joinConversation', { conversationId });
   
   // Listen for messages
   socket.on('newMessage', (data) => {
     // Add message to conversation
   });
   
   // Listen for processing status
   socket.on('messageProcessing', (data) => {
     // Update UI
   });
   ```

2. **Message Flow**:
   - User sends message → POST to `/chat/conversations/:id/messages`
   - Receive 202 with userMessage → Display immediately
   - Listen for `newMessage` WebSocket event → Display AI response
   - Show sources in message

3. **Job Tracking**:
   - Store jobId from send message response
   - Poll job status or use SSE
   - Show error if job fails
   - Allow retry on failure

4. **Conversation Management**:
   - Load conversations on mount
   - Create new conversation on "New Chat"
   - Update conversation list on new messages
   - Show unread count

5. **Message Display**:
   - Show user messages on right
   - Show AI messages on left
   - Display sources as expandable sections
   - Show timestamps
   - Format markdown in AI responses

6. **Real-time Updates**:
   - Auto-join conversation on load
   - Listen for new messages
   - Update conversation list
   - Show typing indicators

7. **Error Handling**:
   - Handle WebSocket disconnection
   - Retry failed messages
   - Show error messages
   - Allow manual retry

8. **Performance**:
   - Virtualize long message lists
   - Lazy load old messages
   - Debounce typing indicators
   - Cache conversations

---

## Summary

This guide covers all major features for frontend implementation:

1. **Authentication**: JWT-based with cookie storage
2. **Organizations**: Multi-tenant organization management
3. **Projects**: Project creation and resource linking
4. **App Integrations**: OAuth-based integrations with 6 providers
5. **RAG Chat Bot**: Real-time chat with async LLM processing

### Key Implementation Points

- All authenticated endpoints require cookies
- Use WebSocket for real-time chat updates
- LLM operations are queued - handle async responses
- Permission-based UI - check permissions before showing actions
- SSE for streaming job status updates
- Handle OAuth callbacks for integrations

### Next Steps

1. Set up HTTP client with cookie support
2. Implement WebSocket connection manager
3. Create authentication context/store
4. Build organization/project context
5. Implement chat UI with real-time updates
6. Add integration OAuth flows
7. Handle error states and loading states

---





