import axios, { AxiosInstance } from 'axios';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function createGithubClient(token: string): AxiosInstance {
    return axios.create({
        baseURL: 'https://api.github.com',
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
        },
        validateStatus: status => status < 500,
    });
}

export async function githubApiRequestWithRateLimit({
    token,
    method,
    url,
    params,
    data = undefined,
    retries = 3,
}) {
    const client = createGithubClient(token);

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await client.request({ method, url, params, data });

            const remaining = Number(res.headers['x-ratelimit-remaining'] ?? -1);
            const resetAt = Number(res.headers['x-ratelimit-reset'] ?? 0) * 1000;

            if (res.status === 403 && remaining === 0 && resetAt) {
                const waitMs = Math.max(resetAt - Date.now(), 1_000);
                console.warn(`GitHub rate limit hit. Waiting ${waitMs}ms`);
                await sleep(waitMs);
                continue;
            }

            return res;
        } catch (err) {
            if (attempt === retries) throw err;
            const backoff = Math.pow(2, attempt) * 1000;
            await sleep(backoff);
        }
    }

    throw new Error('GitHub request failed after retries');
}

export async function githubPaginatedFetch({
    token,
    url,
    perPage = 100,
}) {
    let page = 1;
    const results: any[] = [];

    while (true) {
        const res = await githubApiRequestWithRateLimit({
            token,
            method: 'get',
            url,
            params: { per_page: perPage, page },
        });

        if (res.status === 404) break;
        if (res.status >= 400) {
            throw new Error(`GitHub fetch failed: ${res.status}`);
        }

        results.push(...(Array.isArray(res.data) ? res.data : []));

        const link = res.headers['link'];
        if (!link || !link.includes('rel="next"')) break;

        page += 1;
    }

    return results;
}