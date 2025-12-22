import axios from 'axios';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function githubApiRequestWithRateLimit({ token, method, url, params, data, retries = 3 }) {
    // base axios instance
    const instance = axios.create({
        baseURL: 'https://api.github.com',
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
        },
        validateStatus: status => status < 500, // don't throw on 4xx here
    });

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await instance.request({ method, url, params, data });

            // rate limit hit
            const remaining = Number(res.headers['x-ratelimit-remaining'] ?? -1);
            const reset = Number(res.headers['x-ratelimit-reset'] ?? 0) * 1000; // to ms
            if (res.status === 403 && remaining === 0 && reset) {
                const waitMs = Math.max(reset - Date.now(), 1_000);
                console.warn(`Rate limited by GitHub. Waiting ${waitMs}ms`);
                await sleep(waitMs);
                continue; // retry after wait
            }

            // success or 4xx (like 404)
            return res;
        } catch (err) {
            // exponential backoff on network errors
            const backoff = Math.pow(2, attempt) * 1000;
            await sleep(backoff);
            if (attempt === retries) throw err;
        }
    }

    throw new Error('GitHub request failed after retries');
}

// helper to auto iterate pages producing unified array
export async function githubPaginatedFetch({ token, url, perPage = 100 }) {
    let page = 1;
    const results = [];

    while (true) {
        const res = await githubApiRequestWithRateLimit({ token, method: 'get', url, params: { per_page: perPage, page } });
        if (!res || (res.status >= 400 && res.status !== 404)) {
            throw new Error(`GitHub paginated fetch error ${res?.status}`);
        }
        const items = res.data || [];
        results.push(...items);

        // check Link header for next
        const link = res.headers['link'];
        if (!link || !link.includes('rel="next"')) break;

        page += 1;
    }

    return results;
}