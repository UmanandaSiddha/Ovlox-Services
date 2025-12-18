import * as crypto from 'crypto';

const ALGO = 'aes-256-gcm';

export function encrypt(key: string, plaintext: string) {
    if (!key) throw new Error('Missing encryption key');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, crypto.createHash('sha256').update(key).digest(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(key: string, payload: string) {
    const data = Buffer.from(payload, 'base64');
    const iv = data.slice(0, 12);
    const tag = data.slice(12, 28);
    const encrypted = data.slice(28);
    const decipher = crypto.createDecipheriv(ALGO, crypto.createHash('sha256').update(key).digest(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return out.toString('utf8');
}