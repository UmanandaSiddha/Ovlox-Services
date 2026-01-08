import * as crypto from 'crypto';

const ALGO = 'aes-256-gcm';

export function encrypt(key: string, plaintext: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, crypto.createHash('sha256').update(key).digest(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(key: string, payload: string) {
    const data = Buffer.from(payload, 'base64');

    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);

    const decipher = crypto.createDecipheriv(ALGO, crypto.createHash('sha256').update(key).digest(), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
