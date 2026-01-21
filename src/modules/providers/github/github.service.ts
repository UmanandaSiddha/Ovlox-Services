import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExternalProvider, IntegrationStatus, RawEventType } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { decrypt, encrypt } from 'src/utils/encryption';
import { signState } from 'src/utils/oauth-state';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { LlmService } from 'src/modules/llm/llm.service';
import { DebugFixResponse, SecurityRisk } from 'src/utils/types';
import { RedisService } from 'src/services/redis/redis.service';
import { REDIS_ORG_APP_INTEGRATION_STATUS_KEY_PREFIX } from 'src/config/constants';

@Injectable()
export class GithubService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly llmService: LlmService,
        private readonly redisService: RedisService
    ) { }

    private async invalidateOrgIntegrationStatusCacheByOrgId(organizationId: string) {
        try {
            const org = await this.databaseService.organization.findUnique({
                where: { id: organizationId },
                select: { slug: true },
            });
            if (!org?.slug) return;

            const key = `${REDIS_ORG_APP_INTEGRATION_STATUS_KEY_PREFIX}-${org.slug}`;
            await this.redisService.del(key);
        } catch (error) {
            // Best-effort cache invalidation; don't break webhook processing
            console.warn('Failed to invalidate org integration status cache', error?.message || error);
        }
    }

    private async invalidateOrgIntegrationStatusCachesForGithubIdentity(organizationId: string) {
        try {
            const org = await this.databaseService.organization.findUnique({
                where: { id: organizationId },
                select: {
                    ownerId: true,
                    providers: {
                        where: { provider: ExternalProvider.GITHUB },
                        select: { providerUserId: true },
                        take: 1,
                    },
                },
            });

            const providerUserId = org?.providers?.[0]?.providerUserId;
            if (!org?.ownerId || !providerUserId) {
                await this.invalidateOrgIntegrationStatusCacheByOrgId(organizationId);
                return;
            }

            const orgs = await this.databaseService.organization.findMany({
                where: {
                    ownerId: org.ownerId,
                    providers: {
                        some: {
                            provider: ExternalProvider.GITHUB,
                            providerUserId,
                        },
                    },
                },
                select: { slug: true },
            });

            const keys = orgs
                .map((o) => o.slug)
                .filter(Boolean)
                .map((slug) => `${REDIS_ORG_APP_INTEGRATION_STATUS_KEY_PREFIX}-${slug}`);

            if (keys.length > 0) {
                await this.redisService.del(...keys);
            } else {
                await this.invalidateOrgIntegrationStatusCacheByOrgId(organizationId);
            }
        } catch (error) {
            // Best-effort cache invalidation; don't break request flow
            console.warn('Failed to invalidate github identity integration status caches', error?.message || error);
            await this.invalidateOrgIntegrationStatusCacheByOrgId(organizationId);
        }
    }

    async getOAuthUrl(orgId: string, force = false) {
        const GITHUB_CLIENT_ID = this.configService.get<string>('GITHUB_CLIENT_ID');
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        if (!GITHUB_CLIENT_ID || !INTEGRATION_TOKEN_ENCRYPTION_KEY) {
            throw new BadRequestException('Something went wrong');
        }

        const provider = await this.databaseService.provider.findFirst({
            where: {
                organizationId: orgId,
                provider: ExternalProvider.GITHUB
            }
        });

        if (provider && !force) {
            throw new BadRequestException('Provider already exists for this user');
        }

        const state = signState(
            INTEGRATION_TOKEN_ENCRYPTION_KEY,
            JSON.stringify({ orgId, replace: force, ts: Date.now() })
        );

        const params = new URLSearchParams({
            client_id: GITHUB_CLIENT_ID,
            scope: 'read:user',
            state,
        });

        return {
            message: "Github Oauth Url",
            url: `https://github.com/login/oauth/authorize?${params.toString()}`
        };
    }

    async getInstallUrl(orgId: string) {
        const integration = await this.databaseService.integration.findFirst({
            where: {
                organizationId: orgId,
                type: ExternalProvider.GITHUB
            }
        });
        if (!integration) {
            throw new NotFoundException('Integration not found');
        }

        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');
        const GITHUB_APP_SLUG = this.configService.get<string>('GITHUB_APP_SLUG');

        if (!INTEGRATION_TOKEN_ENCRYPTION_KEY || !GITHUB_APP_SLUG) {
            throw new BadRequestException('Something went wrong');
        }

        const state = signState(
            INTEGRATION_TOKEN_ENCRYPTION_KEY,
            JSON.stringify({ orgId, integrationId: integration.id, ts: Date.now() })
        );

        return {
            message: "Github App Installation Url",
            url: `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`
        };
    }

    private async fetchInstallationAccountLogin(installationId: string): Promise<string | null> {
        try {
            const appJwt = this.createAppJwt();
            const res = await axios.get(`https://api.github.com/app/installations/${installationId}`, {
                headers: {
                    Authorization: `Bearer ${appJwt}`,
                    Accept: 'application/vnd.github+json',
                },
            });
            return res.data?.account?.login ? String(res.data.account.login) : null;
        } catch (error) {
            // Best-effort; callback should still succeed even if lookup fails
            return null;
        }
    }

    async handleInstallationCallback(
        orgId: string,
        integrationId: string,
        installationId: string,
    ) {
        const accountLogin = await this.fetchInstallationAccountLogin(installationId);

        await this.databaseService.integration.updateMany({
            where: {
                id: integrationId,
                organizationId: orgId,
                type: ExternalProvider.GITHUB,
            },
            data: {
                status: IntegrationStatus.CONNECTED,
                externalAccountId: String(installationId),
                externalAccount: accountLogin ?? undefined,
            },
        });

        await this.invalidateOrgIntegrationStatusCachesForGithubIdentity(orgId);

        return {
            orgId,
            integrationId,
            installationId: String(installationId),
            externalAccount: accountLogin,
        };
    }

    createAppJwt() {
        const GITHUB_APP_PRIVATE_KEY = this.configService.get<string>('GITHUB_APP_PRIVATE_KEY');
        const GITHUB_APP_ID = this.configService.get<string>('GITHUB_APP_ID');

        if (!GITHUB_APP_PRIVATE_KEY || !GITHUB_APP_ID) {
            throw new BadRequestException('Something went wrong');
        }

        const privateKey = (GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
        const now = Math.floor(Date.now() / 1000);

        return jwt.sign(
            { iat: now - 60, exp: now + (10 * 60), iss: GITHUB_APP_ID },
            privateKey,
            { algorithm: 'RS256' }
        );
    }

    async generateInstallationToken(installationId: string) {
        const appJwt = this.createAppJwt();

        const res = await axios.post(
            `https://api.github.com/app/installations/${installationId}/access_tokens`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${appJwt}`,
                    Accept: 'application/vnd.github+json'
                }
            },
        );

        return {
            token: res.data.token,
            expiresAt: res.data.expires_at,
        };
    }

    async handleOAuthCallback(code: string, orgId: string, replaceProvider = false) {
        const GITHUB_CLIENT_ID = this.configService.get<string>('GITHUB_CLIENT_ID');
        const GITHUB_CLIENT_SECRET = this.configService.get<string>('GITHUB_CLIENT_SECRET');
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !INTEGRATION_TOKEN_ENCRYPTION_KEY) {
            throw new BadRequestException('Something went wrong');
        }

        const tokenRes = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code,
            },
            { headers: { Accept: 'application/json' } },
        );

        const accessToken = tokenRes.data.access_token;
        if (!accessToken) {
            throw new HttpException('GitHub OAuth failed', HttpStatus.BAD_REQUEST);
        }

        const userRes = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const githubUser = userRes.data;

        if (replaceProvider) {
            await this.databaseService.provider.deleteMany({
                where: {
                    organizationId: orgId,
                    provider: ExternalProvider.GITHUB,
                },
            });
        }

        await this.databaseService.provider.upsert({
            where: {
                provider_providerUserId_organizationId: {
                    provider: ExternalProvider.GITHUB,
                    providerUserId: String(githubUser.id),
                    organizationId: orgId,
                },
            },
            update: {
                accessToken: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, accessToken),
            },
            create: {
                provider: ExternalProvider.GITHUB,
                providerUserId: String(githubUser.id),
                identifier: githubUser.login,
                accessToken: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, accessToken),
                organizationId: orgId,
            },
        });

        // Invalidate cached integration status so SSE/HTTP reflects new OAuth connection immediately
        await this.invalidateOrgIntegrationStatusCachesForGithubIdentity(orgId);

        return githubUser;
    }

    async fetchInstallationRepos(integrationId: string) {
        const token = await this.getValidInstallationToken(integrationId);

        const res = await axios.get(
            'https://api.github.com/installation/repositories?sort=pushed&direction=desc&per_page=100',
            {
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github+json',
                },
            }
        );

        const repos = res.data.repositories || [];

        repos.sort((a: any, b: any) => {
            const aTime = new Date(a.pushed_at || a.updated_at).getTime();
            const bTime = new Date(b.pushed_at || b.updated_at).getTime();
            return bTime - aTime;
        });

        const results = repos.map((r: any) => ({
            id: r.id,
            name: r.full_name,
            url: r.html_url,
            updated_at: r.updated_at,
            pushed_at: r.pushed_at,
        }));

        return results;
    }

    async getProjectRepositories(integrationId: string, projectId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        // Get the integration connection for this project
        const connection = await this.databaseService.integrationConnection.findFirst({
            where: {
                projectId,
                integrationId,
            },
        });

        if (!connection) {
            return {
                projectId,
                integrationId,
                repositories: [],
                message: 'No integration connection found for this project'
            };
        }

        const items = connection.items as { repositories?: string[] } | null;
        const linkedRepoNames = items?.repositories || [];

        if (linkedRepoNames.length === 0) {
            return {
                projectId,
                integrationId,
                repositories: [],
                message: 'No repositories linked to this project'
            };
        }

        // Fetch full repo details from GitHub for the linked repos
        const allRepos = await this.fetchInstallationRepos(integrationId);
        const linkedRepos = allRepos.filter((repo: any) => linkedRepoNames.includes(repo.name));

        // Include any repos that are linked but not accessible (permissions changed)
        const accessibleRepoNames = linkedRepos.map((r: any) => r.name);
        const inaccessibleRepos = linkedRepoNames
            .filter(name => !accessibleRepoNames.includes(name))
            .map(name => ({
                id: null,
                name,
                url: `https://github.com/${name}`,
                updated_at: null,
                pushed_at: null,
                accessible: false
            }));

        return {
            projectId,
            integrationId,
            connectionId: connection.id,
            repositories: [
                ...linkedRepos.map((r: any) => ({ ...r, accessible: true })),
                ...inaccessibleRepos
            ]
        };
    }

    async syncRepositories(integrationId: string, projectId?: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        // Fetch all repos from the GitHub installation
        const allRepos = await this.fetchInstallationRepos(integrationId);

        let reposToSync = allRepos;
        let connection: any = null;

        // If projectId provided, filter to only project-specific repos
        if (projectId) {
            connection = await this.databaseService.integrationConnection.findFirst({
                where: {
                    projectId,
                    integrationId,
                },
            });

            if (!connection) {
                throw new NotFoundException(`No integration connection found for project ${projectId}`);
            }

            const items = connection.items as { repositories?: string[] } | null;
            const projectRepoNames = items?.repositories || [];

            if (projectRepoNames.length === 0) {
                return { 
                    synced: 0, 
                    repositories: [],
                    message: 'No repositories configured for this project. Link repositories first.'
                };
            }

            // Filter repos to only those linked to this project
            reposToSync = allRepos.filter((repo: any) => 
                projectRepoNames.includes(repo.name)
            );

            if (reposToSync.length === 0) {
                return { 
                    synced: 0, 
                    repositories: [],
                    message: 'None of the configured repositories are accessible. Check GitHub App permissions.'
                };
            }
        }

        // Sync repos to IntegrationResource
        for (const repo of reposToSync) {
            await this.databaseService.integrationResource.upsert({
                where: {
                    uq_integration_resource_provider: {
                        integrationId: integration.id,
                        provider: ExternalProvider.GITHUB,
                        providerId: String(repo.id),
                    },
                },
                update: {
                    name: repo.name,
                    url: repo.url,
                    metadata: {
                        updated_at: repo.updated_at,
                        pushed_at: repo.pushed_at,
                    },
                    connectionId: connection?.id || undefined,
                },
                create: {
                    integrationId: integration.id,
                    provider: ExternalProvider.GITHUB,
                    providerId: String(repo.id),
                    name: repo.name,
                    url: repo.url,
                    metadata: {
                        updated_at: repo.updated_at,
                        pushed_at: repo.pushed_at,
                    },
                    connectionId: connection?.id || undefined,
                },
            });
        }

        return { 
            synced: reposToSync.length, 
            repositories: reposToSync,
            projectId: projectId || null
        };
    }

    async getValidInstallationToken(integrationId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            select: {
                externalAccountId: true,
                config: true
            }
        });

        if (!integration) {
            throw new NotFoundException(`Integration not found with id: ${integrationId}`);
        }
        if (!integration.externalAccountId) {
            throw new BadRequestException(`Something went wrong`);
        }

        const config = integration.config as any;

        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        if (!INTEGRATION_TOKEN_ENCRYPTION_KEY) {
            throw new BadRequestException('Something went wrong');
        }

        if (config?.token && config?.expiresAt) {
            const expires = new Date(config.expiresAt).getTime();
            if (Date.now() < expires - 60000) {
                return decrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, config.token);
            }
        }

        const { token, expiresAt } = await this.generateInstallationToken(integration.externalAccountId);

        await this.databaseService.integration.update({
            where: { id: integrationId },
            data: {
                config: {
                    ...config,
                    token: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, token),
                    expiresAt,
                },
            },
        });

        return token;
    }

    verifySignature(body: any, signature?: string) {
        const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');

        const raw = JSON.stringify(body);
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

        if (!signature) throw new UnauthorizedException();
        if (
            signature.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        ) {
            throw new UnauthorizedException();
        }
    }

    async handleWebhook(event: string, payload: any) {
        await this.databaseService.webhookEvent.create({
            data: {
                provider: ExternalProvider.GITHUB,
                providerEventId: payload.installation
                    ? String(payload.installation.id)
                    : payload.after,
                payload,
            },
        });

        switch (event) {
            case 'installation':
                return this.installation(payload);
            case 'installation_repositories':
                return this.reposChanged(payload);
            case 'push':
                return this.commit(payload);
            case 'pull_request':
                return this.pullRequest(payload);
            case 'issues':
                return this.issue(payload);
        }
    }

    async installation(payload: any) {
        const installationId = String(payload.installation?.id);
        if (!installationId) return;

        const accountLogin = payload.installation?.account?.login
            ? String(payload.installation.account.login)
            : null;

        // NOTE:
        // - GitHub's installation.account.id is NOT a stable reference to our OAuth Provider providerUserId.
        // - We cannot reliably map a brand new installation to an org without the signed-state callback.
        // Therefore, we only update org integrations already linked to this installationId.

        if (payload.action === 'created') {
            // Best-effort: ensure all orgs already linked to this installationId are marked connected
            const linked = await this.databaseService.integration.findMany({
                where: {
                    type: ExternalProvider.GITHUB,
                    externalAccountId: installationId,
                },
                select: { id: true, organizationId: true },
            });

            if (linked.length > 0) {
                await this.databaseService.integration.updateMany({
                    where: {
                        type: ExternalProvider.GITHUB,
                        externalAccountId: installationId,
                    },
                    data: {
                        status: IntegrationStatus.CONNECTED,
                        externalAccount: accountLogin ?? undefined,
                    },
                });

                const orgIds = Array.from(new Set(linked.map((l) => l.organizationId)));
                await Promise.all(orgIds.map((orgId) => this.invalidateOrgIntegrationStatusCachesForGithubIdentity(orgId)));
            }
        }

        if (payload.action === 'deleted') {
            const linked = await this.databaseService.integration.findMany({
                where: {
                    type: ExternalProvider.GITHUB,
                    externalAccountId: installationId,
                },
                select: { organizationId: true },
            });

            await this.databaseService.integration.updateMany({
                where: {
                    type: ExternalProvider.GITHUB,
                    externalAccountId: installationId,
                },
                data: {
                    status: IntegrationStatus.NOT_CONNECTED,
                    externalAccountId: null,
                    externalAccount: null,
                    config: {},
                },
            });

            const orgIds = Array.from(new Set(linked.map((l) => l.organizationId)));
            await Promise.all(orgIds.map((orgId) => this.invalidateOrgIntegrationStatusCachesForGithubIdentity(orgId)));
        }
    }

    async reposChanged(payload: any) {
        const integration = await this.databaseService.integration.findFirst({
            where: {
                type: ExternalProvider.GITHUB,
                externalAccountId: String(payload.installation.id),
            },
        });
        if (!integration) return;

        console.log(integration);

        // Repo changes can affect what the frontend shows; invalidate org integration cache
        await this.invalidateOrgIntegrationStatusCacheByOrgId(integration.organizationId);

        // for (const repo of payload.repositories_added || []) {
        //     await this.databaseService.integrationResource.upsert({
        //         where: {
        //             uq_integration_resource_provider: {
        //                 integrationId: integration.id,
        //                 provider: ExternalProvider.GITHUB,
        //                 providerId: String(repo.id),
        //             },
        //         },
        //         update: {
        //             name: repo.full_name,
        //             url: repo.html_url,
        //         },
        //         create: {
        //             integrationId: integration.id,
        //             provider: ExternalProvider.GITHUB,
        //             providerId: String(repo.id),
        //             name: repo.full_name,
        //             url: repo.html_url,
        //         },
        //     });
        // }
    }

    /**
     * Helper method to resolve identity and map to OrganizationMember
     */
    private async resolveAuthorIdentity(
        organizationId: string,
        providerUserId: string,
        authorName?: string,
        authorEmail?: string
    ): Promise<{ identityId: string | null; memberId: string | null }> {
        try {
            // Find or create Identity
            let identity = await this.databaseService.identity.findFirst({
                where: {
                    organizationId,
                    provider: ExternalProvider.GITHUB,
                    providerUserId: String(providerUserId),
                },
            });

            if (!identity) {
                identity = await this.databaseService.identity.create({
                    data: {
                        organizationId,
                        provider: ExternalProvider.GITHUB,
                        providerUserId: String(providerUserId),
                        displayName: authorName || undefined,
                        rawProfile: { email: authorEmail || undefined },
                    },
                });
            }

            // Find ContributorMap to get OrganizationMember
            const contributorMap = await this.databaseService.contributorMap.findUnique({
                where: {
                    uq_contributor_map_org_identity: {
                        organizationId,
                        identityId: identity.id,
                    },
                },
                include: { member: true },
            });

            return {
                identityId: identity.id,
                memberId: contributorMap?.memberId || null,
            };
        } catch (error) {
            // If identity resolution fails, return null - event will still be created
            return { identityId: null, memberId: null };
        }
    }

    async commit(payload: any) {
        const commit = payload.head_commit;
        if (!commit) return;

        // Find integration by repository URL or installation ID
        const repoFullName = payload.repository?.full_name;
        const installationId = payload.installation?.id;

        if (!repoFullName && !installationId) {
            console.warn('GitHub commit webhook: missing repository and installation info');
            return;
        }

        // Find integration
        const integration = await this.databaseService.integration.findFirst({
            where: {
                type: ExternalProvider.GITHUB,
                ...(installationId ? { externalAccountId: String(installationId) } : {}),
            },
            include: { organization: true },
        });

        if (!integration) {
            console.warn(`GitHub commit webhook: Integration not found for installation ${installationId}`);
            return;
        }

        // Find IntegrationResource for this repo
        const resource = repoFullName
            ? await this.databaseService.integrationResource.findFirst({
                  where: {
                      integrationId: integration.id,
                      provider: ExternalProvider.GITHUB,
                      providerId: String(payload.repository.id),
                  },
              })
            : null;

        // Find projects connected to this integration that include this repo
        const connections = await this.databaseService.integrationConnection.findMany({
            where: {
                integrationId: integration.id,
                ...(repoFullName && resource
                    ? {
                          items: {
                              path: ['repos'],
                              array_contains: repoFullName,
                          },
                      }
                    : {}),
            },
            include: { project: true },
        });

        // Resolve author identity
        const authorId = commit.author?.id || commit.author?.username;
        const { identityId, memberId } = authorId
            ? await this.resolveAuthorIdentity(integration.organizationId, authorId, commit.author?.name, commit.author?.email)
            : { identityId: null, memberId: null };

        // Create RawEvent for each connected project (or one if no connections)
        const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : [null];

        for (const project of projectsToProcess) {
            const rawEvent = await this.databaseService.rawEvent.create({
                data: {
                    integrationId: integration.id,
                    projectId: project?.id || null,
                    resourceId: resource?.providerId || String(payload.repository.id),
                    source: ExternalProvider.GITHUB,
                    sourceId: payload.after || commit.id,
                    eventType: RawEventType.COMMIT,
                    authorIdentityId: identityId,
                    authorMemberId: memberId,
                    authorName: commit.author?.name,
                    authorEmail: commit.author?.email,
                    timestamp: new Date(commit.timestamp || Date.now()),
                    content: commit.message,
                    metadata: {
                        repository: payload.repository,
                        commits: payload.commits,
                        pusher: payload.pusher,
                        ref: payload.ref,
                        filesChanged: commit.added?.length + commit.modified?.length + commit.removed?.length || 0,
                    },
                },
            });

            // Queue LLM processing if project exists
            if (project) {
                try {
                    await this.llmService.processRawEvent(rawEvent.id);
                } catch (error) {
                    console.error(`Failed to process RawEvent ${rawEvent.id}:`, error);
                }
            }
        }
    }

    async pullRequest(payload: any) {
        const pr = payload.pull_request;
        if (!pr) return;

        const repoFullName = payload.repository?.full_name;
        const installationId = payload.installation?.id;

        if (!repoFullName && !installationId) {
            console.warn('GitHub PR webhook: missing repository and installation info');
            return;
        }

        // Find integration
        const integration = await this.databaseService.integration.findFirst({
            where: {
                type: ExternalProvider.GITHUB,
                ...(installationId ? { externalAccountId: String(installationId) } : {}),
            },
            include: { organization: true },
        });

        if (!integration) {
            console.warn(`GitHub PR webhook: Integration not found for installation ${installationId}`);
            return;
        }

        // Find IntegrationResource for this repo
        const resource = repoFullName
            ? await this.databaseService.integrationResource.findFirst({
                  where: {
                      integrationId: integration.id,
                      provider: ExternalProvider.GITHUB,
                      providerId: String(payload.repository.id),
                  },
              })
            : null;

        // Find projects connected to this integration that include this repo
        const connections = await this.databaseService.integrationConnection.findMany({
            where: {
                integrationId: integration.id,
                ...(repoFullName && resource
                    ? {
                          items: {
                              path: ['repos'],
                              array_contains: repoFullName,
                          },
                      }
                    : {}),
            },
            include: { project: true },
        });

        // Resolve author identity
        const authorId = pr.user?.id || pr.user?.login;
        const { identityId, memberId } = authorId
            ? await this.resolveAuthorIdentity(integration.organizationId, String(authorId), pr.user?.login, pr.user?.email)
            : { identityId: null, memberId: null };

        // Create RawEvent for each connected project
        const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : [null];

        for (const project of projectsToProcess) {
            const rawEvent = await this.databaseService.rawEvent.create({
                data: {
                    integrationId: integration.id,
                    projectId: project?.id || null,
                    resourceId: resource?.providerId || String(payload.repository.id),
                    source: ExternalProvider.GITHUB,
                    sourceId: String(pr.id),
                    eventType: RawEventType.PULL_REQUEST,
                    authorIdentityId: identityId,
                    authorMemberId: memberId,
                    authorName: pr.user?.login,
                    authorEmail: pr.user?.email,
                    timestamp: new Date(pr.created_at || pr.updated_at || Date.now()),
                    content: pr.title,
                    metadata: {
                        repository: payload.repository,
                        action: payload.action,
                        pull_request: {
                            number: pr.number,
                            state: pr.state,
                            merged: pr.merged,
                            mergeable: pr.mergeable,
                            additions: pr.additions,
                            deletions: pr.deletions,
                            changed_files: pr.changed_files,
                            base: pr.base,
                            head: pr.head,
                        },
                    },
                },
            });

            // Queue LLM processing if project exists
            if (project) {
                try {
                    await this.llmService.processRawEvent(rawEvent.id);
                } catch (error) {
                    console.error(`Failed to process RawEvent ${rawEvent.id}:`, error);
                }
            }
        }
    }

    async issue(payload: any) {
        const issue = payload.issue;
        if (!issue) return;

        const repoFullName = payload.repository?.full_name;
        const installationId = payload.installation?.id;

        if (!repoFullName && !installationId) {
            console.warn('GitHub issue webhook: missing repository and installation info');
            return;
        }

        // Find integration
        const integration = await this.databaseService.integration.findFirst({
            where: {
                type: ExternalProvider.GITHUB,
                ...(installationId ? { externalAccountId: String(installationId) } : {}),
            },
            include: { organization: true },
        });

        if (!integration) {
            console.warn(`GitHub issue webhook: Integration not found for installation ${installationId}`);
            return;
        }

        // Find IntegrationResource for this repo
        const resource = repoFullName
            ? await this.databaseService.integrationResource.findFirst({
                  where: {
                      integrationId: integration.id,
                      provider: ExternalProvider.GITHUB,
                      providerId: String(payload.repository.id),
                  },
              })
            : null;

        // Find projects connected to this integration that include this repo
        const connections = await this.databaseService.integrationConnection.findMany({
            where: {
                integrationId: integration.id,
                ...(repoFullName && resource
                    ? {
                          items: {
                              path: ['repos'],
                              array_contains: repoFullName,
                          },
                      }
                    : {}),
            },
            include: { project: true },
        });

        // Resolve author identity
        const authorId = issue.user?.id || issue.user?.login;
        const { identityId, memberId } = authorId
            ? await this.resolveAuthorIdentity(integration.organizationId, String(authorId), issue.user?.login, issue.user?.email)
            : { identityId: null, memberId: null };

        // Create RawEvent for each connected project
        const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : [null];

        for (const project of projectsToProcess) {
            const rawEvent = await this.databaseService.rawEvent.create({
                data: {
                    integrationId: integration.id,
                    projectId: project?.id || null,
                    resourceId: resource?.providerId || String(payload.repository.id),
                    source: ExternalProvider.GITHUB,
                    sourceId: String(issue.id),
                    eventType: RawEventType.ISSUE,
                    authorIdentityId: identityId,
                    authorMemberId: memberId,
                    authorName: issue.user?.login,
                    authorEmail: issue.user?.email,
                    timestamp: new Date(issue.created_at || issue.updated_at || Date.now()),
                    content: issue.title,
                    metadata: {
                        repository: payload.repository,
                        action: payload.action,
                        issue: {
                            number: issue.number,
                            state: issue.state,
                            labels: issue.labels,
                            assignees: issue.assignees,
                            milestone: issue.milestone,
                            comments: issue.comments,
                            body: issue.body,
                        },
                    },
                },
            });

            // Queue LLM processing if project exists
            if (project) {
                try {
                    await this.llmService.processRawEvent(rawEvent.id);
                } catch (error) {
                    console.error(`Failed to process RawEvent ${rawEvent.id}:`, error);
                }
            }
        }
    }


    // Test Services

    private async resolveGithubContext(integrationId: string, repoFullName?: string, projectId?: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration || !integration.externalAccountId) {
            throw new BadRequestException("Invalid GitHub integration");
        }

        let owner: string;
        let repo: string;

        if (repoFullName) {
            // Parse owner/repo from full name (e.g., "owner/repo")
            const parts = repoFullName.split('/');
            if (parts.length !== 2) {
                throw new BadRequestException("Invalid repository format. Expected 'owner/repo'");
            }
            [owner, repo] = parts;

            // If projectId provided, verify the repo is linked to this project
            if (projectId) {
                const connection = await this.databaseService.integrationConnection.findFirst({
                    where: { projectId, integrationId },
                });
                const items = connection?.items as { repositories?: string[] } | null;
                const projectRepos = items?.repositories || [];
                if (!projectRepos.includes(repoFullName)) {
                    throw new BadRequestException("Repository is not linked to this project");
                }
            }
        } else if (projectId) {
            // Get first repo from project's linked repositories
            const connection = await this.databaseService.integrationConnection.findFirst({
                where: { projectId, integrationId },
            });

            if (!connection) {
                throw new BadRequestException("No integration connection found for this project");
            }

            const items = connection.items as { repositories?: string[] } | null;
            const projectRepos = items?.repositories || [];

            if (projectRepos.length === 0) {
                throw new BadRequestException("No repositories linked to this project. Link repositories first.");
            }

            // Use the first linked repo
            const firstRepo = projectRepos[0];
            const parts = firstRepo.split('/');
            if (parts.length !== 2) {
                throw new BadRequestException("Invalid repository format in project configuration");
            }
            [owner, repo] = parts;
        } else {
            // Get the first synced repository from IntegrationResource
            const resource = await this.databaseService.integrationResource.findFirst({
                where: {
                    integrationId: integration.id,
                    provider: ExternalProvider.GITHUB,
                },
                orderBy: {
                    updatedAt: 'desc',
                },
            });

            if (!resource || !resource.name) {
                throw new BadRequestException("No repositories synced. Please sync repositories first.");
            }

            const parts = resource.name.split('/');
            if (parts.length !== 2) {
                throw new BadRequestException("Invalid repository format in database. Expected 'owner/repo'");
            }
            [owner, repo] = parts;
        }

        if (!owner || !repo) {
            throw new BadRequestException("Repo not configured for integration");
        }

        const token = await this.getValidInstallationToken(integrationId);

        return { token, owner, repo };
    }

    private truncatePatch(patch?: string, max = 3000) {
        if (!patch) return null;
        return patch.length > max
            ? patch.slice(0, max) + "\n// diff truncated"
            : patch;
    }

    async getGithubOverview(integrationId: string, repoFullName?: string, projectId?: string) {
        const { token, owner, repo } = await this.resolveGithubContext(integrationId, repoFullName, projectId);

        const headers = {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
        };

        const [repoRes, commitsRes, prsRes, issuesRes] = await Promise.all([
            axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
            axios.get(
                `https://api.github.com/repos/${owner}/${repo}/commits?per_page=20`,
                { headers }
            ),
            axios.get(
                `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=20`,
                { headers }
            ),
            axios.get(
                `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=20`,
                { headers }
            ),
        ]);

        return {
            repo: {
                name: repoRes.data.name,
                description: repoRes.data.description,
                defaultBranch: repoRes.data.default_branch,
                stars: repoRes.data.stargazers_count,
                forks: repoRes.data.forks_count,
            },
            activity: {
                commits: commitsRes.data.length,
                pullRequests: prsRes.data.length,
                issues: issuesRes.data.filter((i: any) => !i.pull_request).length,
            },
            status: prsRes.data.some((p: any) => !p.merged_at)
                ? "issue"
                : "success",
        };
    }

    async getGithubCommits(integrationId: string, limit = 5, repoFullName?: string, projectId?: string) {
        const { token, owner, repo } =
            await this.resolveGithubContext(integrationId, repoFullName, projectId);

        const headers = {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
        };

        const commitsRes = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${limit}`,
            { headers }
        );

        return {
            commits: await Promise.all(
                commitsRes.data.map(async (c: any) => {
                    const detail = await axios.get(
                        `https://api.github.com/repos/${owner}/${repo}/commits/${c.sha}`,
                        { headers }
                    );

                    return {
                        sha: c.sha,
                        message: c.commit.message,
                        author: c.commit.author?.name,
                        date: c.commit.author?.date,
                        authorAvatar: c.author?.avatar_url ?? null,
                        authorUsername: c.author?.login ?? null,
                        filesChanged: detail.data.files?.length,
                        additions: detail.data.stats?.additions,
                        deletions: detail.data.stats?.deletions,
                    };
                })
            ),
        };
    }

    async getGithubCommitDetail(
        integrationId: string,
        sha: string,
        repoFullName?: string,
        projectId?: string
    ) {
        const { token, owner, repo } =
            await this.resolveGithubContext(integrationId, repoFullName, projectId);

        const headers = {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
        };

        const res = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
            { headers }
        );

        const { commit, files, stats } = res.data;

        const normalizedFiles = files.map((f: any) => ({
            filename: f.filename,
            patch: this.truncatePatch(f.patch),
        }));

        let aiSummary = "AI summary unavailable";
        let codeQuality = {
            score: null,
            summary: "Code quality analysis not available for small changes.",
            issues: [],
            suggestions: [],
        };
        let security = {
            risk: "none",
            summary: "",
            findings: [],
            canAutoFix: false,
        };

        if (stats.total > 10) {
            try {
                // Get organizationId from integration
                const integration = await this.databaseService.integration.findUnique({
                    where: { id: integrationId },
                    select: { organizationId: true },
                });

                if (!integration) {
                    throw new BadRequestException(`Integration ${integrationId} not found`);
                }

                const organizationId = integration.organizationId;

                // Use LlmService methods instead of helper functions
                const [summary, quality, securityResult] = await Promise.all([
                    this.llmService.summarizeCodeChange(
                        organizationId,
                        {
                            title: commit.message,
                            description: commit.message,
                            files: normalizedFiles,
                        },
                        sha // Use commit SHA as referenceId
                    ),
                    this.llmService.analyzeCodeQuality(organizationId, { files: normalizedFiles }, sha),
                    this.llmService.analyzeSecurityRisk(organizationId, { files: normalizedFiles }, sha),
                ]);

                aiSummary = summary;
                codeQuality = quality;
                security = securityResult;
            } catch (err) {
                console.error("LLM failed:", err);
            }
        }

        return {
            commit: {
                sha,
                message: commit.message,
                author: commit.author?.name,
                date: commit.author?.date,
            },
            aiSummary,
            codeQuality,
            security,
            canDebug: security.risk !== "none" && security.canAutoFix,
            files: files.map((f: any) => ({
                filename: f.filename,
                additions: f.additions,
                deletions: f.deletions,
                patch: f.patch ?? null,
            })),
        };
    }

    async getGithubPullRequests(integrationId: string, limit = 5, repoFullName?: string, projectId?: string) {
        const { token, owner, repo } =
            await this.resolveGithubContext(integrationId, repoFullName, projectId);

        const headers = {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
        };

        const prsRes = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=${limit}`,
            { headers }
        );

        return {
            pullRequests: await Promise.all(
                prsRes.data.map(async (pr: any) => {
                    const filesRes = await axios.get(
                        `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/files`,
                        { headers }
                    );

                    return {
                        id: pr.id,
                        number: pr.number,
                        title: pr.title,
                        state: pr.state,
                        merged: !!pr.merged_at,
                        commits: pr.commits,
                        filesChanged: filesRes.data.length,
                        additions: filesRes.data.reduce(
                            (a: number, f: any) => a + f.additions,
                            0
                        ),
                        deletions: filesRes.data.reduce(
                            (a: number, f: any) => a + f.deletions,
                            0
                        ),
                        aiSummary:
                            "This PR implements real-time notifications using WebSockets.",
                    };
                })
            ),
        };
    }

    async getGithubIssues(integrationId: string, limit = 5, repoFullName?: string, projectId?: string) {
        const { token, owner, repo } =
            await this.resolveGithubContext(integrationId, repoFullName, projectId);

        const headers = {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
        };

        const res = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=${limit}`,
            { headers }
        );

        return {
            issues: res.data
                .filter((i: any) => !i.pull_request)
                .map((issue: any) => ({
                    number: issue.number,
                    title: issue.title,
                    state: issue.state,
                    labels: issue.labels.map((l: any) => l.name),
                    aiAnalysis:
                        "The issue appears to be related to memory usage during file upload.",
                    suggestedFix:
                        "Implement streaming file uploads and validate size early.",
                })),
        };
    }

    async debugGithubCommit(
        integrationId: string,
        sha: string,
        repoFullName?: string,
        projectId?: string
    ): Promise<DebugFixResponse> {
        const detail = await this.getGithubCommitDetail(integrationId, sha, repoFullName, projectId);

        if (!detail.security.canAutoFix) {
            throw new BadRequestException("No auto-fixable security issues");
        }

        // Get organizationId from integration
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            select: { organizationId: true },
        });

        if (!integration) {
            throw new BadRequestException(`Integration ${integrationId} not found`);
        }

        const fixText = await this.llmService.generateDebugFix(
            integration.organizationId,
            {
                issueTitle: detail.security.summary,
                recentDiffs: detail.files
                    .map((f: any) => `File: ${f.filename}\n${f.patch ?? ""}`)
                    .join("\n\n"),
            },
            sha // Use commit SHA as referenceId
        );

        return {
            explanation: fixText,
            patches: [],
            suggestedCode: null,
            risk: detail.security.risk as SecurityRisk,
            confidence: 0.75,
            safeToApply:
                detail.security.canAutoFix &&
                detail.security.risk !== "high",
        };
    }
}