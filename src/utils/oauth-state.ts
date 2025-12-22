import * as crypto from 'crypto';


export function signState(key: string, payload: string) {
    const h = crypto.createHmac('sha256', key).update(payload).digest('hex');
    return `${payload}:${h}`; // simple payload:hmac
}


export function verifyState(key: string, state: string) {
    const [payload, h] = state.split(':');
    const expected = crypto.createHmac('sha256', key).update(payload).digest('hex');
    return expected === h ? payload : null;
}