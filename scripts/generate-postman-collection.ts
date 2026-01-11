import * as fs from 'fs';
import * as path from 'path';

/**
 * Simple Postman Collection Generator
 * 
 * This script generates a Postman collection JSON file by scanning
 * controller files and extracting route information.
 * 
 * Note: This is a basic implementation. For production use, consider
 * using @nestjs/swagger or a more sophisticated solution.
 */

interface PostmanCollection {
    info: {
        name: string;
        description: string;
        schema: string;
    };
    variable: Array<{ key: string; value: string; type: string }>;
    item: PostmanItem[];
}

interface PostmanItem {
    name: string;
    item?: PostmanItem[];
    request?: PostmanRequest;
}

interface PostmanRequest {
    method: string;
    header: Array<{ key: string; value: string; type: string }>;
    url: {
        raw: string;
        host: string[];
        path: string[];
        query?: Array<{ key: string; value: string; disabled?: boolean }>;
    };
    body?: {
        mode: string;
        raw?: string;
        formdata?: Array<{ key: string; value: string; type: string }>;
    };
}

// Manually define all endpoints based on the implemented controllers
const endpoints: Endpoint[] = [
    // Auth endpoints
    {
        folder: 'Auth',
        name: 'Request OTP',
        method: 'POST',
        path: '/api/v1/auth/request-otp',
        body: { phoneNumber: 'string', email: 'string' },
    },
    {
        folder: 'Auth',
        name: 'Sign Up',
        method: 'POST',
        path: '/api/v1/auth/signup',
        body: { phoneNumber: 'string', email: 'string', password: 'string', firstName: 'string', lastName: 'string' },
    },
    {
        folder: 'Auth',
        name: 'Verify OTP',
        method: 'POST',
        path: '/api/v1/auth/verify-otp',
        body: { otpString: 'string', phoneNumber: 'string', email: 'string' },
    },
    {
        folder: 'Auth',
        name: 'Login',
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { phoneNumber: 'string', email: 'string', password: 'string' },
    },
    {
        folder: 'Auth',
        name: 'Refresh Token',
        method: 'POST',
        path: '/api/v1/auth/refresh',
    },
    {
        folder: 'Auth',
        name: 'Logout',
        method: 'POST',
        path: '/api/v1/auth/logout',
    },

    // Organizations
    {
        folder: 'Organizations',
        name: 'Create Organization',
        method: 'POST',
        path: '/api/v1/orgs/create',
        body: { name: 'string', inviteMembers: 'array', appProviders: 'array' },
    },
    {
        folder: 'Organizations',
        name: 'Get User Organizations',
        method: 'GET',
        path: '/api/v1/orgs/user',
    },
    {
        folder: 'Organizations',
        name: 'Get Organization By ID',
        method: 'GET',
        path: '/api/v1/orgs/user/byId/:id',
    },
    {
        folder: 'Organizations',
        name: 'Get Organization By Slug',
        method: 'GET',
        path: '/api/v1/orgs/user/bySlug/:slug',
    },

    // Payments
    {
        folder: 'Payments',
        name: 'Create Payment Intent',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/payments/create-intent',
        body: { amount: 'number', currency: 'usd', creditsAmount: 'number' },
    },
    {
        folder: 'Payments',
        name: 'List Payments',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/payments',
        query: [{ key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
    },
    {
        folder: 'Payments',
        name: 'Get Payment',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/payments/:id',
    },
    {
        folder: 'Payments',
        name: 'Refund Payment',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/payments/:id/refund',
        body: { amount: 'number' },
    },
    {
        folder: 'Payments',
        name: 'Create Subscription',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/payments/subscriptions/create',
        body: { priceId: 'string', planName: 'string', monthlyCredits: 'number' },
    },
    {
        folder: 'Payments',
        name: 'List Subscriptions',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/payments/subscriptions',
    },
    {
        folder: 'Payments',
        name: 'Cancel Subscription',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/payments/subscriptions/:id/cancel',
        body: { cancelAtPeriodEnd: 'boolean' },
    },
    {
        folder: 'Payments',
        name: 'Get Credit Balance',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/payments/credits/balance',
    },
    {
        folder: 'Payments',
        name: 'Get Credit Transactions',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/payments/credits/transactions',
        query: [{ key: 'limit', value: '50' }, { key: 'offset', value: '0' }, { key: 'type', value: 'string' }],
    },
    {
        folder: 'Payments',
        name: 'Stripe Webhook',
        method: 'POST',
        path: '/api/v1/payments/webhook',
        headers: [{ key: 'stripe-signature', value: '{{stripe_signature}}' }],
    },

    // Tasks
    {
        folder: 'Tasks',
        name: 'Create Task',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks',
        body: { title: 'string', description: 'string', status: 'TODO', priority: 1, dueDate: 'string', completionDeadline: 'string' },
    },
    {
        folder: 'Tasks',
        name: 'List Tasks',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks',
        query: [{ key: 'status', value: 'TODO' }, { key: 'assigneeId', value: 'string' }, { key: 'priority', value: '1' }, { key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
    },
    {
        folder: 'Tasks',
        name: 'Get Task',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id',
    },
    {
        folder: 'Tasks',
        name: 'Update Task',
        method: 'PUT',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id',
        body: { title: 'string', description: 'string', status: 'TODO', priority: 1 },
    },
    {
        folder: 'Tasks',
        name: 'Delete Task',
        method: 'DELETE',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id',
    },
    {
        folder: 'Tasks',
        name: 'Assign Task',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id/assign',
        body: { assigneeId: 'string', teamId: 'string' },
    },
    {
        folder: 'Tasks',
        name: 'Create Task Team',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id/team',
        body: { name: 'string', memberIds: ['string'] },
    },
    {
        folder: 'Tasks',
        name: 'Add Team Member',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id/team/members',
        body: { memberId: 'string', role: 'string' },
    },
    {
        folder: 'Tasks',
        name: 'Remove Team Member',
        method: 'DELETE',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id/team/members/:memberId',
    },
    {
        folder: 'Tasks',
        name: 'Update Task Status',
        method: 'PUT',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id/status',
        body: { status: 'TODO' },
    },
    {
        folder: 'Tasks',
        name: 'Link Event to Task',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/projects/:projectId/tasks/:id/link-event',
        body: { rawEventId: 'string', relationship: 'string', relevance: 1.0 },
    },

    // Features
    {
        folder: 'Features',
        name: 'Create Feature',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/projects/:projectId/features',
        body: { name: 'string', description: 'string' },
    },
    {
        folder: 'Features',
        name: 'List Features',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/projects/:projectId/features',
        query: [{ key: 'status', value: 'DISCOVERED' }, { key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
    },
    {
        folder: 'Features',
        name: 'Get Feature',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/projects/:projectId/features/:id',
    },
    {
        folder: 'Features',
        name: 'Update Feature',
        method: 'PUT',
        path: '/api/v1/orgs/:orgId/projects/:projectId/features/:id',
        body: { name: 'string', description: 'string', status: 'DISCOVERED' },
    },
    {
        folder: 'Features',
        name: 'Delete Feature',
        method: 'DELETE',
        path: '/api/v1/orgs/:orgId/projects/:projectId/features/:id',
    },
    {
        folder: 'Features',
        name: 'Update Feature Status',
        method: 'PUT',
        path: '/api/v1/orgs/:orgId/projects/:projectId/features/:id/status',
        body: { status: 'DISCOVERED' },
    },
    {
        folder: 'Features',
        name: 'Link Event to Feature',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/projects/:projectId/features/:id/link-event',
        body: { rawEventId: 'string', relevance: 1.0 },
    },

    // Contributors
    {
        folder: 'Contributors',
        name: 'Create Contributor Map',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/contributors/maps',
        body: { identityId: 'string', memberId: 'string' },
    },
    {
        folder: 'Contributors',
        name: 'List Contributor Maps',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/contributors/maps',
        query: [{ key: 'memberId', value: 'string' }, { key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
    },
    {
        folder: 'Contributors',
        name: 'Get Contributor Map',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/contributors/maps/:id',
    },
    {
        folder: 'Contributors',
        name: 'Update Contributor Map',
        method: 'PUT',
        path: '/api/v1/orgs/:orgId/contributors/maps/:id',
        body: { memberId: 'string' },
    },
    {
        folder: 'Contributors',
        name: 'Delete Contributor Map',
        method: 'DELETE',
        path: '/api/v1/orgs/:orgId/contributors/maps/:id',
    },
    {
        folder: 'Contributors',
        name: 'Get Unmapped Identities',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/contributors/identities/unmapped',
    },

    // Roles
    {
        folder: 'Roles',
        name: 'Create Role',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/roles',
        body: { name: 'string', description: 'string' },
    },
    {
        folder: 'Roles',
        name: 'List Roles',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/roles',
    },
    {
        folder: 'Roles',
        name: 'Get Role',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/roles/:id',
    },
    {
        folder: 'Roles',
        name: 'Update Role',
        method: 'PUT',
        path: '/api/v1/orgs/:orgId/roles/:id',
        body: { name: 'string', description: 'string' },
    },
    {
        folder: 'Roles',
        name: 'Delete Role',
        method: 'DELETE',
        path: '/api/v1/orgs/:orgId/roles/:id',
    },
    {
        folder: 'Roles',
        name: 'Assign Permissions to Role',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/roles/:id/permissions',
        body: { permissionIds: ['string'] },
    },
    {
        folder: 'Roles',
        name: 'Remove Permissions from Role',
        method: 'DELETE',
        path: '/api/v1/orgs/:orgId/roles/:id/permissions',
        body: { permissionIds: ['string'] },
    },
    {
        folder: 'Roles',
        name: 'Get Available Permissions',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/roles/permissions/available',
    },
    {
        folder: 'Roles',
        name: 'Assign Role to Member',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/roles/assign/:memberId',
        body: { roleId: 'string' },
    },

    // Reports
    {
        folder: 'Reports',
        name: 'Generate Report',
        method: 'POST',
        path: '/api/v1/orgs/:orgId/projects/:projectId/reports/generate',
        body: { type: 'DAILY', startDate: 'string', endDate: 'string' },
    },
    {
        folder: 'Reports',
        name: 'List Reports',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/projects/:projectId/reports',
        query: [{ key: 'type', value: 'DAILY' }, { key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
    },
    {
        folder: 'Reports',
        name: 'Get Report',
        method: 'GET',
        path: '/api/v1/orgs/:orgId/projects/:projectId/reports/:id',
    },

    // LLM Chat
    {
        folder: 'Chat',
        name: 'Create Conversation',
        method: 'POST',
        path: '/api/v1/chat/conversations',
        body: { name: 'string', organizationId: 'string', projectId: 'string' },
    },
    {
        folder: 'Chat',
        name: 'List Conversations',
        method: 'GET',
        path: '/api/v1/chat/conversations',
        query: [{ key: 'organizationId', value: 'string' }, { key: 'projectId', value: 'string' }],
    },
    {
        folder: 'Chat',
        name: 'Get Conversation',
        method: 'GET',
        path: '/api/v1/chat/conversations/:id',
    },
    {
        folder: 'Chat',
        name: 'Update Conversation',
        method: 'PUT',
        path: '/api/v1/chat/conversations/:id',
        body: { name: 'string' },
    },
    {
        folder: 'Chat',
        name: 'Send Message',
        method: 'POST',
        path: '/api/v1/chat/conversations/:id/messages',
        body: { question: 'string' },
    },
    {
        folder: 'Chat',
        name: 'Get Messages',
        method: 'GET',
        path: '/api/v1/chat/conversations/:id/messages',
        query: [{ key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
    },

    // Provider Integrations (sample endpoints)
    {
        folder: 'Integrations/GitHub',
        name: 'Install GitHub',
        method: 'GET',
        path: '/api/v1/github/install/:orgId/:integrationId',
    },
    {
        folder: 'Integrations/GitHub',
        name: 'GitHub Callback',
        method: 'GET',
        path: '/api/v1/github/callback',
        query: [{ key: 'code', value: 'string' }, { key: 'state', value: 'string' }],
    },
    {
        folder: 'Integrations/GitHub',
        name: 'Sync Repositories',
        method: 'POST',
        path: '/api/v1/github/sync-repos/:integrationId',
    },
];

interface Endpoint {
    folder: string;
    name: string;
    method: string;
    path: string;
    headers?: Array<{ key: string; value: string }>;
    body?: any;
    query?: Array<{ key: string; value: string; description?: string }>;
}

function createPostmanRequest(endpoint: Endpoint, baseUrl: string): PostmanRequest {
    const pathParts = endpoint.path.split('/').filter((p) => p);
    const urlPath = pathParts.map((p) => {
        if (p.startsWith(':')) {
            return `{{${p.substring(1)}}}`;
        }
        return p;
    });

    const request: PostmanRequest = {
        method: endpoint.method,
        header: [
            { key: 'Content-Type', value: 'application/json', type: 'text' },
            { key: 'Authorization', value: 'Bearer {{access_token}}', type: 'text' },
            ...(endpoint.headers || []).map((h) => ({ key: h.key, value: h.value, type: 'text' })),
        ],
        url: {
            raw: `${baseUrl}${endpoint.path}`,
            host: [baseUrl.replace(/^https?:\/\//, '')],
            path: urlPath,
        },
    };

    if (endpoint.query && endpoint.query.length > 0) {
        request.url.query = endpoint.query.map((q) => ({
            key: q.key,
            value: q.value,
            disabled: false,
        }));
    }

    if (endpoint.body) {
        request.body = {
            mode: 'raw',
            raw: JSON.stringify(endpoint.body, null, 2),
        };
    }

    return request;
}

function organizeEndpoints(endpointsList: Endpoint[]): PostmanItem[] {
    const folders: Record<string, PostmanItem[]> = {};

    endpointsList.forEach((endpoint) => {
        if (!folders[endpoint.folder]) {
            folders[endpoint.folder] = [];
        }

        folders[endpoint.folder].push({
            name: endpoint.name,
            request: createPostmanRequest(endpoint, '{{base_url}}'),
        });
    });

    return Object.entries(folders).map(([folderName, items]) => ({
        name: folderName,
        item: items,
    }));
}

function generateCollection(): PostmanCollection {
    return {
        info: {
            name: 'Ovlox V2 API',
            description: 'Complete API collection for Ovlox V2 Backend',
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        variable: [
            { key: 'base_url', value: 'http://localhost:4000', type: 'string' },
            { key: 'access_token', value: '', type: 'string' },
            { key: 'orgId', value: '', type: 'string' },
            { key: 'projectId', value: '', type: 'string' },
            { key: 'stripe_signature', value: '', type: 'string' },
        ],
        item: organizeEndpoints(endpoints),
    };
}

// Main execution
const collection = generateCollection();
const outputPath = path.join(__dirname, '../ovlox-v2-api.postman_collection.json');

fs.writeFileSync(outputPath, JSON.stringify(collection, null, 2));
console.log(`Postman collection generated at: ${outputPath}`);
console.log(`Total endpoints: ${endpoints.length}`);
