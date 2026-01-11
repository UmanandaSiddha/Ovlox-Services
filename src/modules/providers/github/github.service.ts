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

@Injectable()
export class GithubService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly llmService: LlmService
    ) { }

    async getOAuthUrl(orgId: string) {
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

        if (provider) {
            throw new BadRequestException('Provider already exists for this user');
        }

        const state = signState(
            INTEGRATION_TOKEN_ENCRYPTION_KEY,
            JSON.stringify({ orgId, ts: Date.now() })
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

    async handleOAuthCallback(code: string, orgId: string) {
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

        console.log("User Data: ", userRes.data);

        const githubUser = userRes.data;

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

    async syncRepositories(integrationId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const repos = await this.fetchInstallationRepos(integrationId);

        // Sync repos to IntegrationResource
        for (const repo of repos) {
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
                },
            });
        }

        return { synced: repos.length, repositories: repos };
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
                    token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, token),
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
        console.log("Event: ", event);

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
        const id = String(payload.installation.id);

        const provider = await this.databaseService.provider.findFirst({
            where: {
                provider: ExternalProvider.GITHUB,
                providerUserId: String(payload.installation.account.id),
            }
        });

        if (payload.action === 'created') {
            const integration = await this.databaseService.integration.findFirst({
                where: {
                    organizationId: provider.organizationId,
                    type: ExternalProvider.GITHUB,
                    status: IntegrationStatus.NOT_CONNECTED,
                }
            });

            if (integration) {
                await this.databaseService.integration.update({
                    where: {
                        id: integration.id
                    },
                    data: {
                        status: IntegrationStatus.CONNECTED,
                        externalAccountId: id,
                        externalAccount: String(payload.installation.account.login),
                    },
                });
            }
        }

        if (payload.action === 'deleted') {
            const integration = await this.databaseService.integration.findFirst({
                where: {
                    organizationId: provider.organizationId,
                    type: ExternalProvider.GITHUB,
                    externalAccountId: id,
                }
            });

            if (integration) {
                await this.databaseService.integration.updateMany({
                    where: {
                        organizationId: provider.organizationId,
                        type: ExternalProvider.GITHUB,
                        externalAccountId: id,
                    },
                    data: {
                        status: IntegrationStatus.NOT_CONNECTED,
                        externalAccountId: null,
                        config: {},
                    },
                });
            }
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

    private async resolveGithubContext(integrationId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration || !integration.externalAccountId) {
            throw new BadRequestException("Invalid GitHub integration");
        }

        // const { owner, repo } = integration.config as {
        //     owner: string;
        //     repo: string;
        // };

        const owner = "UmanandaSiddha";
        const repo = "Ghibli-Portfolio";

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

    async getGithubOverview(integrationId: string) {
        const { token, owner, repo } = await this.resolveGithubContext(integrationId);

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

    async getGithubCommits(integrationId: string, limit = 5) {
        const { token, owner, repo } =
            await this.resolveGithubContext(integrationId);

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
        sha: string
    ) {
        const { token, owner, repo } =
            await this.resolveGithubContext(integrationId);

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

    async getGithubPullRequests(integrationId: string, limit = 5) {
        const { token, owner, repo } =
            await this.resolveGithubContext(integrationId);

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

    async getGithubIssues(integrationId: string, limit = 5) {
        const { token, owner, repo } =
            await this.resolveGithubContext(integrationId);

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
        sha: string
    ): Promise<DebugFixResponse> {
        const detail = await this.getGithubCommitDetail(integrationId, sha);

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