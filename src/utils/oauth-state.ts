import * as crypto from 'crypto';

export function signState(key: string, payload: string): string {
    const hmac = crypto
        .createHmac('sha256', key)
        .update(payload)
        .digest('hex');

    return Buffer.from(`${payload}.${hmac}`).toString('base64url');
}

export function verifyState(secret: string, state: string): string | null {
    try {
        const decoded = Buffer.from(state, 'base64url').toString();
        const [payload, receivedHmac] = decoded.split('.');

        if (!payload || !receivedHmac) return null;

        const expectedHmac = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        if (!crypto.timingSafeEqual(
            Buffer.from(receivedHmac),
            Buffer.from(expectedHmac)
        )) {
            return null;
        }

        const data = JSON.parse(payload);
        if (data.ts && Date.now() - data.ts > 10 * 60 * 1000) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}