# Missing Features from Frontend Implementation Guide

This document lists all backend features that are **not** documented in the Frontend Implementation Guide.

## 1. User Management

### Endpoints
- **POST** `/user/update-profile` - Update user profile
- **PUT** `/user/update-details` - Update user details
- **GET** `/user/me` - Get current user profile
- **GET** `/user/all-users` - List all users (Admin only)
- **GET** `/user/byId/:id` - Get user by ID (Admin only)
- **DELETE** `/user/delete/:id` - Delete user (Admin only)

### Features
- User profile management
- Admin user management
- User details update

---

## 2. Payments & Subscriptions

### Endpoints
- **POST** `/orgs/:orgId/payments/create-intent` - Create Stripe payment intent
- **GET** `/orgs/:orgId/payments` - List payments
- **GET** `/orgs/:orgId/payments/:id` - Get payment details
- **POST** `/orgs/:orgId/payments/:id/refund` - Refund payment
- **POST** `/orgs/:orgId/payments/subscriptions/create` - Create subscription
- **GET** `/orgs/:orgId/payments/subscriptions` - List subscriptions
- **POST** `/orgs/:orgId/payments/subscriptions/:id/cancel` - Cancel subscription
- **GET** `/orgs/:orgId/payments/credits/balance` - Get credit balance
- **GET** `/orgs/:orgId/payments/credits/transactions` - Get credit transactions
- **POST** `/payments/webhook` - Stripe webhook handler (public)

### Features
- Stripe payment integration
- Payment intents for credit purchases
- Subscription management
- Credit balance tracking
- Credit transaction history
- Payment refunds
- Webhook handling for payment events

---

## 3. Tasks Management

### Endpoints
- **POST** `/orgs/:orgId/projects/:projectId/tasks` - Create task
- **GET** `/orgs/:orgId/projects/:projectId/tasks` - List tasks (with filters)
- **GET** `/orgs/:orgId/projects/:projectId/tasks/:id` - Get task details
- **PUT** `/orgs/:orgId/projects/:projectId/tasks/:id` - Update task
- **DELETE** `/orgs/:orgId/projects/:projectId/tasks/:id` - Delete task
- **POST** `/orgs/:orgId/projects/:projectId/tasks/:id/assign` - Assign task to user or team
- **POST** `/orgs/:orgId/projects/:projectId/tasks/:id/team` - Create task team
- **POST** `/orgs/:orgId/projects/:projectId/tasks/:id/team/members` - Add team member
- **DELETE** `/orgs/:orgId/projects/:projectId/tasks/:id/team/members/:memberId` - Remove team member
- **PUT** `/orgs/:orgId/projects/:projectId/tasks/:id/status` - Update task status
- **POST** `/orgs/:orgId/projects/:projectId/tasks/:id/link-event` - Link raw event to task

### Features
- Task CRUD operations
- Task assignment (individual or team)
- Task teams management
- Task status workflow (TODO, IN_PROGRESS, REVIEW, DONE, BLOCKED)
- Task filtering by status, assignee, priority
- Link tasks to raw events (commits, PRs, etc.)

---

## 4. Features Management

### Endpoints
- **POST** `/orgs/:orgId/projects/:projectId/features` - Create feature
- **GET** `/orgs/:orgId/projects/:projectId/features` - List features
- **GET** `/orgs/:orgId/projects/:projectId/features/:id` - Get feature details
- **PUT** `/orgs/:orgId/projects/:projectId/features/:id` - Update feature
- **DELETE** `/orgs/:orgId/projects/:projectId/features/:id` - Delete feature
- **PUT** `/orgs/:orgId/projects/:projectId/features/:id/status` - Update feature status
- **POST** `/orgs/:orgId/projects/:projectId/features/:id/link-event` - Link raw event to feature

### Features
- Feature tracking and management
- Feature status updates
- Link features to raw events (commits, PRs, etc.)
- Feature filtering by status

---

## 5. Contributors & Identity Mapping

### Endpoints
- **POST** `/orgs/:orgId/contributors/maps` - Create contributor map
- **GET** `/orgs/:orgId/contributors/maps` - List contributor maps
- **GET** `/orgs/:orgId/contributors/maps/:id` - Get contributor map
- **PUT** `/orgs/:orgId/contributors/maps/:id` - Update contributor map
- **DELETE** `/orgs/:orgId/contributors/maps/:id` - Delete contributor map
- **GET** `/orgs/:orgId/contributors/identities/unmapped` - Get unmapped identities

### Features
- Map external identities (GitHub, Slack, etc.) to organization members
- Contributor identity resolution
- Track unmapped identities for mapping

---

## 6. Roles & Permissions Management

### Endpoints
- **POST** `/orgs/:orgId/roles` - Create custom role template
- **GET** `/orgs/:orgId/roles` - List role templates
- **GET** `/orgs/:orgId/roles/:id` - Get role template
- **PUT** `/orgs/:orgId/roles/:id` - Update role template
- **DELETE** `/orgs/:orgId/roles/:id` - Delete role template
- **POST** `/orgs/:orgId/roles/:id/permissions` - Assign permissions to role
- **DELETE** `/orgs/:orgId/roles/:id/permissions` - Remove permissions from role
- **GET** `/orgs/:orgId/roles/permissions/available` - Get available permissions
- **POST** `/orgs/:orgId/roles/assign/:memberId` - Assign role to member

### Features
- Custom role template creation
- Permission assignment to roles
- Role assignment to members
- Available permissions listing

---

## 7. File Storage (S3)

### Endpoints
- **POST** `/orgs/:orgId/storage/presigned-upload` - Get presigned upload URL
- **GET** `/orgs/:orgId/storage/presigned-download` - Get presigned download URL

### Features
- S3 presigned URLs for file uploads
- Support for organization, project, and user folders
- Presigned download URLs for secure file access
- Configurable expiration times

---

## 8. Credit Analytics

### Endpoints
- **GET** `/orgs/:orgId/analytics/credits/expenditure` - Get organization credit expenditure
- **GET** `/orgs/:orgId/analytics/credits/projects/:projectId` - Get project credit expenditure

### Features
- Credit usage analytics
- Organization-level credit expenditure
- Project-level credit expenditure
- Date range filtering
- Credit usage breakdown

---

## 9. Health Checks

### Endpoints
- **GET** `/health/redis-health` - Check Redis connection health
- **GET** `/health/queue-stats` - Get queue statistics
- **DELETE** `/health/flush` - Flush all queues (development)

### Features
- Redis health monitoring
- Queue statistics
- Development utilities

---

## 10. Project Reports (Additional Details)

### Already Mentioned But Could Be Expanded
- **GET** `/orgs/:orgId/projects/:projectId/reports` - List project reports
- **GET** `/orgs/:orgId/projects/:projectId/reports/:id` - Get report details

### Additional Features
- Report type filtering (DAILY, WEEKLY, MONTHLY)
- Report pagination
- Report generation status tracking
- Report history

---

## Summary

### High Priority Features (Core Functionality)
1. **User Management** - Essential for user profiles
2. **Payments & Subscriptions** - Critical for monetization
3. **Tasks Management** - Core project management feature
4. **File Storage** - Needed for file uploads/downloads

### Medium Priority Features
5. **Features Management** - Project tracking
6. **Roles & Permissions** - Advanced access control
7. **Credit Analytics** - Usage monitoring

### Lower Priority Features
8. **Contributors Mapping** - Identity resolution
9. **Health Checks** - System monitoring
10. **Project Reports** - Already partially documented

---

## Recommendations

1. **Add User Management section** - Profile updates, admin features
2. **Add Payments section** - Stripe integration, subscriptions, credits
3. **Add Tasks section** - Task management, assignment, teams
4. **Add Features section** - Feature tracking
5. **Add Storage section** - S3 presigned URLs
6. **Add Analytics section** - Credit usage analytics
7. **Expand Roles section** - Custom roles and permissions
8. **Add Contributors section** - Identity mapping

These features are fully implemented in the backend but missing from the frontend implementation guide.
